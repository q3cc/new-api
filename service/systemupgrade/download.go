package systemupgrade

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

const (
	maxBinarySize     = 300 << 20
	maxSmallAssetSize = 64 << 10
	readIdleTimeout   = 60 * time.Second
)

var safeVersion = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

// binaryAssetName is the release file built for this machine.
func binaryAssetName() string {
	return "new-api-" + runtime.GOOS + "-" + runtime.GOARCH
}

// downloadVerified downloads this machine's binary of release into dir. The
// checksums must carry a valid signature and the binary must match its
// checksum; otherwise nothing is left in dir. It returns the binary's path and
// SHA-256.
func downloadVerified(ctx context.Context, client *http.Client, release Release, dir string, progress func(done, total int64)) (string, string, error) {
	if !safeVersion.MatchString(release.Version) {
		return "", "", fmt.Errorf("invalid version %q", release.Version)
	}
	key, err := publicKey()
	if err != nil {
		return "", "", err
	}
	checksums, err := fetchAsset(ctx, client, release, checksumsAsset)
	if err != nil {
		return "", "", err
	}
	signature, err := fetchAsset(ctx, client, release, signatureAsset)
	if err != nil {
		return "", "", err
	}
	if !ed25519.Verify(key, checksums, signature) {
		return "", "", errors.New("the release signature is invalid")
	}
	want, ok := parseChecksums(checksums)[binaryAssetName()]
	if !ok {
		return "", "", fmt.Errorf("this release has no binary for %s/%s", runtime.GOOS, runtime.GOARCH)
	}
	url := release.assets[binaryAssetName()]
	if url == "" {
		return "", "", fmt.Errorf("the release is missing %s", binaryAssetName())
	}

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", "", err
	}
	final := filepath.Join(dir, "new-api-"+release.Version)
	part := final + ".part"
	got, err := downloadFile(ctx, client, url, part, progress)
	if err != nil {
		_ = os.Remove(part)
		return "", "", err
	}
	if got != want {
		_ = os.Remove(part)
		return "", "", errors.New("the downloaded binary does not match the signed checksum")
	}
	if err := os.Chmod(part, 0o755); err != nil {
		_ = os.Remove(part)
		return "", "", err
	}
	if err := os.Rename(part, final); err != nil {
		_ = os.Remove(part)
		return "", "", err
	}
	return final, got, nil
}

func fetchAsset(ctx context.Context, client *http.Client, release Release, name string) ([]byte, error) {
	url := release.assets[name]
	if url == "" {
		return nil, fmt.Errorf("the release is missing %s", name)
	}
	resp, err := get(ctx, client, url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxSmallAssetSize+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxSmallAssetSize {
		return nil, fmt.Errorf("%s is too large", name)
	}
	return data, nil
}

// downloadFile streams url into path and returns its SHA-256. A download that
// stalls for a minute or exceeds the size limit fails.
func downloadFile(ctx context.Context, client *http.Client, url, path string, progress func(done, total int64)) (string, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	idle := time.AfterFunc(readIdleTimeout, cancel)
	defer idle.Stop()

	resp, err := get(ctx, client, url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.ContentLength > maxBinarySize {
		return "", errors.New("the binary is larger than allowed")
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return "", err
	}
	defer file.Close()

	hash := sha256.New()
	buf := make([]byte, 256<<10)
	var done int64
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			idle.Reset(readIdleTimeout)
			done += int64(n)
			if done > maxBinarySize {
				return "", errors.New("the binary is larger than allowed")
			}
			if _, err := file.Write(buf[:n]); err != nil {
				return "", err
			}
			hash.Write(buf[:n])
			if progress != nil {
				progress(done, resp.ContentLength)
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			if ctx.Err() != nil {
				return "", errors.New("the download stalled")
			}
			return "", readErr
		}
	}
	if err := file.Sync(); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func get(ctx context.Context, client *http.Client, url string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "new-api")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("download failed with status %d", resp.StatusCode)
	}
	return resp, nil
}

// parseChecksums reads sha256sum output: "<hex>  <file name>" per line.
func parseChecksums(data []byte) map[string]string {
	sums := map[string]string{}
	scanner := bufio.NewScanner(bytes.NewReader(data))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) != 2 {
			continue
		}
		sums[strings.TrimPrefix(fields[1], "*")] = strings.ToLower(fields[0])
	}
	return sums
}
