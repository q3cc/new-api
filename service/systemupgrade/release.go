// Package systemupgrade finds new releases of this server on GitHub, downloads
// and verifies the binary for this machine, and hands it to the hot-upgrade
// supervisor.
package systemupgrade

import (
	"cmp"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// Every push to main publishes a release tagged main-YYYYMMDD-<sha> with the
// Linux binaries, their checksums and a signature of the checksums.
const (
	defaultReleaseAPI = "https://api.github.com/repos/q3cc/new-api/releases?per_page=30"
	releaseTagPrefix  = "main-"
	checksumsAsset    = "checksums.txt"
	signatureAsset    = "checksums.txt.sig"

	// releasePublicKey verifies checksums.txt.sig. Its private half is the
	// UPDATE_SIGNING_KEY secret of the GitHub repository.
	releasePublicKey = "pLQFvN9JfuYzx5RDsdOgHP5WGLg0DS8E1BDRfy4N6H4="
)

// Environment overrides for a self-hosted release mirror or a test server.
const (
	EnvReleaseAPI = "UPDATE_RELEASE_API"
	EnvPublicKey  = "UPDATE_PUBLIC_KEY"
)

// Release is one published version.
type Release struct {
	Version     string `json:"version"`
	Notes       string `json:"notes"`
	URL         string `json:"url"`
	PublishedAt int64  `json:"published_at"`

	assets map[string]string
}

type githubRelease struct {
	TagName     string    `json:"tag_name"`
	Body        string    `json:"body"`
	HTMLURL     string    `json:"html_url"`
	Draft       bool      `json:"draft"`
	PublishedAt time.Time `json:"published_at"`
	Assets      []struct {
		Name string `json:"name"`
		URL  string `json:"browser_download_url"`
	} `json:"assets"`
}

func releaseAPI() string {
	if api := strings.TrimSpace(os.Getenv(EnvReleaseAPI)); api != "" {
		return api
	}
	return defaultReleaseAPI
}

func publicKey() (ed25519.PublicKey, error) {
	encoded := releasePublicKey
	if override := strings.TrimSpace(os.Getenv(EnvPublicKey)); override != "" {
		encoded = override
	}
	key, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(key) != ed25519.PublicKeySize {
		return nil, errors.New("the release public key is invalid")
	}
	return key, nil
}

// fetchReleases lists the published main releases, newest first.
func fetchReleases(ctx context.Context, client *http.Client) ([]Release, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, releaseAPI(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "new-api")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests {
		return nil, errors.New("GitHub rate limit reached; try again later")
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub returned status %d", resp.StatusCode)
	}
	var payload []githubRelease
	if err := common.DecodeJson(resp.Body, &payload); err != nil {
		return nil, err
	}
	releases := make([]Release, 0, len(payload))
	for _, item := range payload {
		if item.Draft || !strings.HasPrefix(item.TagName, releaseTagPrefix) {
			continue
		}
		release := Release{
			Version:     item.TagName,
			Notes:       item.Body,
			URL:         item.HTMLURL,
			PublishedAt: item.PublishedAt.Unix(),
			assets:      map[string]string{},
		}
		for _, asset := range item.Assets {
			release.assets[asset.Name] = asset.URL
		}
		releases = append(releases, release)
	}
	slices.SortStableFunc(releases, func(a, b Release) int { return cmp.Compare(b.PublishedAt, a.PublishedAt) })
	return releases, nil
}

// newerThan reports whether latest replaces current. Versions are build
// names, not numbers, so the release dates decide; a current version that is
// not among the releases (too old, or a build that never was released) is
// replaced by the latest one.
func newerThan(latest Release, current string, releases []Release) bool {
	if latest.Version == current {
		return false
	}
	for _, release := range releases {
		if release.Version == current {
			return latest.PublishedAt > release.PublishedAt
		}
	}
	return true
}
