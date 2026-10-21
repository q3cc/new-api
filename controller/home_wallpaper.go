package controller

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"math/rand/v2"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "image/gif"
	_ "image/png"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

// The random wallpaper service sends no CORS headers, so the browser cannot
// upload it as a WebGL texture. Serving it same-origin lets the home page fetch
// one picture and share it between the CSS backdrop and the glass shader.
var homeWallpaperURL = "https://randpic.esa.starcity.ink/l"

// Visitors draw from a small rotating set of pictures instead of each page
// view consuming a fresh upstream download, so upstream traffic is bounded by
// the rotation rather than by visits, and repeat visitors hit their browser
// cache. Tests set the size to zero and fill the set directly.
var (
	homeWallpaperPoolSize       = 6
	homeWallpaperRotateInterval = 15 * time.Minute
)

// homeWallpaperWidths are the variants kept per picture, smallest first. The
// page asks for the smallest one that covers its viewport in device pixels.
var homeWallpaperWidths = []int{1280, 1920}

const (
	homeWallpaperTimeout  = 15 * time.Second
	maxHomeWallpaperBytes = 16 << 20
	homeWallpaperQuality  = 80
	// image.Decode allocates from the header, and a compressed file can claim
	// gigabytes of pixels; refuse anything beyond a sane allocation.
	maxHomeWallpaperPixels = 40 << 20
	// A picture URL names its content, so browsers and CDNs may keep it.
	homeWallpaperCacheControl = "public, max-age=604800, immutable"
)

type homeWallpaperVariant struct {
	data        []byte
	contentType string
}

type homeWallpaper struct {
	id       string
	variants map[int]homeWallpaperVariant // keyed by homeWallpaperWidths
}

var (
	homeWallpaperOnce     sync.Once
	homeWallpaperMu       sync.RWMutex
	homeWallpaperPictures []*homeWallpaper // oldest first
	// startHomeWallpaperRotation runs the rotation; tests replace it.
	startHomeWallpaperRotation = func() { go rotateHomeWallpapers() }
)

// fetchHomeWallpaper downloads one random picture and prepares its variants.
func fetchHomeWallpaper(ctx context.Context) (*homeWallpaper, error) {
	ctx, cancel := context.WithTimeout(ctx, homeWallpaperTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, homeWallpaperURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "image/webp,image/*;q=0.8")
	// The picture service answers with a redirect to the chosen file on its own
	// host. The upstream is fixed operator configuration rather than user input,
	// so the general SSRF redirect policy (which also rejects fake-IP DNS answers
	// from local proxies) does not apply; the hop is still confined to that host.
	client := &http.Client{
		Transport: service.GetHttpClient().Transport,
		Timeout:   homeWallpaperTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return errors.New("stopped after 10 redirects")
			}
			origin := via[0].URL
			if req.URL.Scheme != origin.Scheme || !strings.EqualFold(req.URL.Host, origin.Host) {
				return fmt.Errorf("redirect to %s leaves the wallpaper host", req.URL)
			}
			return nil
		},
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("upstream status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxHomeWallpaperBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) == 0 || len(data) > maxHomeWallpaperBytes {
		return nil, fmt.Errorf("upstream body of %d bytes is out of range", len(data))
	}
	// The upstream labels pictures application/octet-stream; sniff the bytes
	// so only images reach the browser under an image content type.
	contentType := http.DetectContentType(data)
	if !strings.HasPrefix(contentType, "image/") {
		return nil, fmt.Errorf("upstream sent %s instead of an image", contentType)
	}
	return newHomeWallpaper(data, contentType)
}

// newHomeWallpaper scales the picture to each served width as a JPEG.
// Pictures that already fit a width, or that Go cannot decode, are served
// as-is for it; pictures that declare absurd dimensions are refused.
func newHomeWallpaper(data []byte, contentType string) (*homeWallpaper, error) {
	digest := sha256.Sum256(data)
	picture := &homeWallpaper{
		id:       hex.EncodeToString(digest[:8]),
		variants: make(map[int]homeWallpaperVariant, len(homeWallpaperWidths)),
	}
	original := homeWallpaperVariant{data: data, contentType: contentType}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err == nil && int64(config.Width)*int64(config.Height) > maxHomeWallpaperPixels {
		return nil, fmt.Errorf("upstream picture declares %dx%d pixels", config.Width, config.Height)
	}
	var source image.Image
	if err == nil && max(config.Width, config.Height) > homeWallpaperWidths[0] {
		source, _, _ = image.Decode(bytes.NewReader(data))
	}
	for _, width := range homeWallpaperWidths {
		picture.variants[width] = original
		if source == nil || max(config.Width, config.Height) <= width {
			continue
		}
		scale := float64(width) / float64(max(config.Width, config.Height))
		target := image.NewRGBA(image.Rect(0, 0, max(1, int(float64(config.Width)*scale)), max(1, int(float64(config.Height)*scale))))
		draw.BiLinear.Scale(target, target.Bounds(), source, source.Bounds(), draw.Src, nil)
		var encoded bytes.Buffer
		if jpeg.Encode(&encoded, target, &jpeg.Options{Quality: homeWallpaperQuality}) == nil {
			picture.variants[width] = homeWallpaperVariant{data: encoded.Bytes(), contentType: "image/jpeg"}
		}
	}
	return picture, nil
}

// addHomeWallpaper adds a picture, retiring the oldest once the set is full,
// and reports whether the set is full. A picture already present is skipped.
func addHomeWallpaper(picture *homeWallpaper, size int) bool {
	homeWallpaperMu.Lock()
	defer homeWallpaperMu.Unlock()
	for _, existing := range homeWallpaperPictures {
		if existing.id == picture.id {
			return len(homeWallpaperPictures) >= size
		}
	}
	homeWallpaperPictures = append(homeWallpaperPictures, picture)
	if len(homeWallpaperPictures) > size {
		homeWallpaperPictures = homeWallpaperPictures[len(homeWallpaperPictures)-size:]
	}
	return len(homeWallpaperPictures) >= size
}

// rotateHomeWallpapers fills the set quickly, then replaces one picture per
// rotation interval for the lifetime of the process, backing off while the
// picture service is unavailable.
func rotateHomeWallpapers() {
	backoff := time.Second
	for {
		picture, err := fetchHomeWallpaper(context.Background())
		if err != nil {
			common.SysLog("home wallpaper prefetch failed: " + err.Error())
			time.Sleep(backoff)
			backoff = min(backoff*2, time.Minute)
			continue
		}
		backoff = time.Second
		if addHomeWallpaper(picture, homeWallpaperPoolSize) {
			time.Sleep(homeWallpaperRotateInterval)
		}
	}
}

// homeWallpaperEnabled reports whether the built-in cinematic home page is the
// one being served. A custom home page never requests the wallpaper, so
// fetching pictures would only cost upstream traffic.
func homeWallpaperEnabled() bool {
	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	return strings.TrimSpace(common.OptionMap["HomePageContent"]) == ""
}

// StartHomeWallpaperPrefetch begins filling the picture set so visitors are
// served from memory. main starts it after the options are loaded, and the
// wallpaper request starts it too in case the built-in home page was enabled
// later. Safe to call repeatedly.
func StartHomeWallpaperPrefetch() {
	if homeWallpaperPoolSize <= 0 || !homeWallpaperEnabled() {
		return
	}
	homeWallpaperOnce.Do(startHomeWallpaperRotation)
}

// homeWallpaperWidth is the smallest served width covering the requested one;
// a missing or invalid request gets the largest.
func homeWallpaperWidth(requested string) int {
	want, err := strconv.Atoi(requested)
	if err != nil || want <= 0 {
		return homeWallpaperWidths[len(homeWallpaperWidths)-1]
	}
	for _, width := range homeWallpaperWidths {
		if width >= want {
			return width
		}
	}
	return homeWallpaperWidths[len(homeWallpaperWidths)-1]
}

// GetHomeWallpaper picks a random picture and redirects to its cacheable URL.
// It never waits on the upstream: until the first picture arrives it fails
// fast and the page shows its bundled wallpaper instead.
func GetHomeWallpaper(c *gin.Context) {
	StartHomeWallpaperPrefetch()
	c.Header("Cache-Control", "no-store")
	homeWallpaperMu.RLock()
	var picture *homeWallpaper
	if count := len(homeWallpaperPictures); count > 0 {
		picture = homeWallpaperPictures[rand.IntN(count)]
	}
	homeWallpaperMu.RUnlock()
	if picture == nil {
		c.Status(http.StatusServiceUnavailable)
		return
	}
	width := homeWallpaperWidth(c.Query("w"))
	c.Redirect(http.StatusFound, fmt.Sprintf("/api/home/wallpaper/%s?w=%d", picture.id, width))
}

// GetHomeWallpaperImage serves one picture variant under its content-named URL.
func GetHomeWallpaperImage(c *gin.Context) {
	id := c.Param("id")
	homeWallpaperMu.RLock()
	var picture *homeWallpaper
	for _, candidate := range homeWallpaperPictures {
		if candidate.id == id {
			picture = candidate
			break
		}
	}
	homeWallpaperMu.RUnlock()
	if picture == nil {
		// Retired by rotation; the page falls back to its bundled wallpaper.
		c.Header("Cache-Control", "no-store")
		c.Status(http.StatusNotFound)
		return
	}
	width := homeWallpaperWidth(c.Query("w"))
	variant := picture.variants[width]
	etag := fmt.Sprintf(`"%s-%d"`, picture.id, width)
	c.Header("Cache-Control", homeWallpaperCacheControl)
	c.Header("ETag", etag)
	c.Header("X-Content-Type-Options", "nosniff")
	if c.GetHeader("If-None-Match") == etag {
		c.Status(http.StatusNotModified)
		return
	}
	c.Data(http.StatusOK, variant.contentType, variant.data)
}
