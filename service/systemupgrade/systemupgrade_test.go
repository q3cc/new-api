package systemupgrade

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// releaseServer serves a GitHub-style release list and the assets of one
// signed release.
type releaseServer struct {
	server     *httptest.Server
	privateKey ed25519.PrivateKey
	assets     map[string][]byte
	list       []map[string]any
}

func newReleaseServer(t *testing.T) *releaseServer {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	t.Setenv(EnvPublicKey, base64.StdEncoding.EncodeToString(publicKey))
	rs := &releaseServer{privateKey: privateKey, assets: map[string][]byte{}}
	rs.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/releases" {
			data, _ := common.Marshal(rs.list)
			_, _ = w.Write(data)
			return
		}
		data, ok := rs.assets[strings.TrimPrefix(r.URL.Path, "/assets/")]
		if !ok {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(data)
	}))
	t.Cleanup(rs.server.Close)
	t.Setenv(EnvReleaseAPI, rs.server.URL+"/releases")
	return rs
}

// publish adds a release whose checksums are signed and whose binary for
// this machine is binary.
func (rs *releaseServer) publish(tag string, published time.Time, binary []byte) Release {
	sum := sha256.Sum256(binary)
	checksums := fmt.Sprintf("%s  %s\n%s  new-api-linux-other\n", hex.EncodeToString(sum[:]), binaryAssetName(), strings.Repeat("a", 64))
	rs.assets[tag+"/"+binaryAssetName()] = binary
	rs.assets[tag+"/"+checksumsAsset] = []byte(checksums)
	rs.assets[tag+"/"+signatureAsset] = ed25519.Sign(rs.privateKey, []byte(checksums))
	assets := []map[string]any{}
	release := Release{Version: tag, PublishedAt: published.Unix(), assets: map[string]string{}}
	for _, name := range []string{binaryAssetName(), checksumsAsset, signatureAsset} {
		url := rs.server.URL + "/assets/" + tag + "/" + name
		assets = append(assets, map[string]any{"name": name, "browser_download_url": url})
		release.assets[name] = url
	}
	rs.list = append(rs.list, map[string]any{
		"tag_name":     tag,
		"body":         "- " + tag,
		"html_url":     "https://example.test/" + tag,
		"published_at": published.UTC().Format(time.RFC3339),
		"assets":       assets,
	})
	return release
}

func TestFetchReleasesKeepsPublishedMainBuildsNewestFirst(t *testing.T) {
	rs := newReleaseServer(t)
	day := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	rs.publish("main-20261101-aaaaaaa", day, []byte("a"))
	rs.publish("main-20261103-ccccccc", day.Add(48*time.Hour), []byte("c"))
	rs.publish("v1.0.0", day.Add(72*time.Hour), []byte("tagged"))
	rs.publish("main-20261102-bbbbbbb", day.Add(24*time.Hour), []byte("b"))
	rs.list = append(rs.list, map[string]any{"tag_name": "main-20261104-ddddddd", "draft": true, "published_at": day.Add(96 * time.Hour).Format(time.RFC3339)})

	releases, err := fetchReleases(context.Background(), rs.server.Client())

	require.NoError(t, err)
	versions := make([]string, 0, len(releases))
	for _, release := range releases {
		versions = append(versions, release.Version)
	}
	assert.Equal(t, []string{"main-20261103-ccccccc", "main-20261102-bbbbbbb", "main-20261101-aaaaaaa"}, versions,
		"drafts and other tags are ignored")
}

func TestNewerThanComparesReleaseDates(t *testing.T) {
	releases := []Release{
		{Version: "main-3", PublishedAt: 300},
		{Version: "main-2", PublishedAt: 200},
		{Version: "main-1", PublishedAt: 100},
	}
	tests := []struct {
		name    string
		current string
		want    bool
	}{
		{"running the latest", "main-3", false},
		{"running an older release", "main-1", true},
		{"running a build that was never released", "v0.0.0", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, newerThan(releases[0], tt.current, releases))
		})
	}
}

func TestDownloadVerifiedInstallsSignedBinary(t *testing.T) {
	rs := newReleaseServer(t)
	binary := []byte("#!/bin/sh\necho new\n")
	release := rs.publish("main-20261102-bbbbbbb", time.Now(), binary)
	dir := t.TempDir()
	var lastDone int64

	path, sum, err := downloadVerified(context.Background(), rs.server.Client(), release, dir, func(done, total int64) { lastDone = done })

	require.NoError(t, err)
	assert.Equal(t, filepath.Join(dir, "new-api-main-20261102-bbbbbbb"), path)
	expected := sha256.Sum256(binary)
	assert.Equal(t, hex.EncodeToString(expected[:]), sum)
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Equal(t, binary, data)
	info, err := os.Stat(path)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o755), info.Mode().Perm())
	assert.EqualValues(t, len(binary), lastDone)
}

func TestDownloadVerifiedRejectsUntrustedFiles(t *testing.T) {
	tests := []struct {
		name    string
		tamper  func(rs *releaseServer, tag string)
		message string
	}{
		{
			name: "binary replaced after signing",
			tamper: func(rs *releaseServer, tag string) {
				rs.assets[tag+"/"+binaryAssetName()] = []byte("evil")
			},
			message: "does not match the signed checksum",
		},
		{
			name: "checksums replaced to match another binary",
			tamper: func(rs *releaseServer, tag string) {
				sum := sha256.Sum256([]byte("evil"))
				rs.assets[tag+"/"+binaryAssetName()] = []byte("evil")
				rs.assets[tag+"/"+checksumsAsset] = []byte(hex.EncodeToString(sum[:]) + "  " + binaryAssetName() + "\n")
			},
			message: "signature is invalid",
		},
		{
			name: "signed with another key",
			tamper: func(rs *releaseServer, tag string) {
				_, otherKey, _ := ed25519.GenerateKey(rand.Reader)
				rs.assets[tag+"/"+signatureAsset] = ed25519.Sign(otherKey, rs.assets[tag+"/"+checksumsAsset])
			},
			message: "signature is invalid",
		},
		{
			name: "no binary for this machine",
			tamper: func(rs *releaseServer, tag string) {
				checksums := []byte(strings.Repeat("b", 64) + "  new-api-linux-other\n")
				rs.assets[tag+"/"+checksumsAsset] = checksums
				rs.assets[tag+"/"+signatureAsset] = ed25519.Sign(rs.privateKey, checksums)
			},
			message: "has no binary for",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rs := newReleaseServer(t)
			tag := "main-20261102-bbbbbbb"
			release := rs.publish(tag, time.Now(), []byte("good"))
			tt.tamper(rs, tag)
			dir := t.TempDir()

			_, _, err := downloadVerified(context.Background(), rs.server.Client(), release, dir, nil)

			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.message)
			entries, _ := os.ReadDir(dir)
			assert.Empty(t, entries, "nothing is left behind")
		})
	}
}

func TestDownloadVerifiedRejectsUnsafeVersionName(t *testing.T) {
	rs := newReleaseServer(t)
	release := rs.publish("main-x", time.Now(), []byte("good"))
	release.Version = "../../etc/new-api"

	_, _, err := downloadVerified(context.Background(), rs.server.Client(), release, t.TempDir(), nil)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid version")
}

func TestApplyRefusesWithoutSupervisor(t *testing.T) {
	assert.ErrorIs(t, Apply("main-20261102-bbbbbbb"), ErrNotSupervised)
	assert.ErrorIs(t, Rollback(context.Background()), ErrNotSupervised)
}
