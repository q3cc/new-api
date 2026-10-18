package controller

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"net/http"
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

// Pictures are fetched ahead of time so a page load is answered from memory
// instead of waiting on the upstream round trip. Tests set this to zero and
// drive the pool channel directly.
var homeWallpaperPrefetch = 3

const (
	homeWallpaperTimeout  = 15 * time.Second
	maxHomeWallpaperBytes = 16 << 20
	// Upstream pictures are ~12 megapixels; the hero never shows more than
	// this, and a smaller JPEG downloads, decodes and uploads much faster.
	maxHomeWallpaperEdge = 1920
	homeWallpaperQuality = 82
	// image.Decode allocates from the header, and a compressed file can claim
	// gigabytes of pixels; refuse anything beyond a sane allocation.
	maxHomeWallpaperPixels = 40 << 20
)

type homeWallpaper struct {
	data        []byte
	contentType string
}

var (
	homeWallpaperOnce sync.Once
	homeWallpaperPool chan homeWallpaper
)

// The picture service answers with a redirect to the chosen file on its own
// host. The upstream is fixed operator configuration rather than user input, so
// the general SSRF redirect policy (which also rejects fake-IP DNS answers from
// local proxies) does not apply; the hop is still confined to that host.
func homeWallpaperClient() *http.Client {
	return &http.Client{
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
}

// fetchHomeWallpaper downloads one random picture and scales it down to the
// size the hero can use.
func fetchHomeWallpaper(ctx context.Context) (homeWallpaper, error) {
	ctx, cancel := context.WithTimeout(ctx, homeWallpaperTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, homeWallpaperURL, nil)
	if err != nil {
		return homeWallpaper{}, err
	}
	req.Header.Set("Accept", "image/webp,image/*;q=0.8")
	resp, err := homeWallpaperClient().Do(req)
	if err != nil {
		return homeWallpaper{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return homeWallpaper{}, fmt.Errorf("upstream status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxHomeWallpaperBytes+1))
	if err != nil {
		return homeWallpaper{}, err
	}
	if len(data) == 0 || len(data) > maxHomeWallpaperBytes {
		return homeWallpaper{}, fmt.Errorf("upstream body of %d bytes is out of range", len(data))
	}
	// The upstream labels pictures application/octet-stream; sniff the bytes
	// so only images reach the browser under an image content type.
	contentType := http.DetectContentType(data)
	if !strings.HasPrefix(contentType, "image/") {
		return homeWallpaper{}, fmt.Errorf("upstream sent %s instead of an image", contentType)
	}
	return fitHomeWallpaper(data, contentType)
}

// fitHomeWallpaper re-encodes oversized pictures as a JPEG no larger than
// maxHomeWallpaperEdge on either side. Pictures that already fit, or that Go
// cannot decode, pass through untouched; pictures that declare absurd
// dimensions are refused rather than decoded.
func fitHomeWallpaper(data []byte, contentType string) (homeWallpaper, error) {
	original := homeWallpaper{data: data, contentType: contentType}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (config.Width <= maxHomeWallpaperEdge && config.Height <= maxHomeWallpaperEdge) {
		return original, nil
	}
	if int64(config.Width)*int64(config.Height) > maxHomeWallpaperPixels {
		return homeWallpaper{}, fmt.Errorf("upstream picture declares %dx%d pixels", config.Width, config.Height)
	}
	source, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return original, nil
	}
	scale := float64(maxHomeWallpaperEdge) / float64(max(config.Width, config.Height))
	target := image.NewRGBA(image.Rect(0, 0, max(1, int(float64(config.Width)*scale)), max(1, int(float64(config.Height)*scale))))
	draw.BiLinear.Scale(target, target.Bounds(), source, source.Bounds(), draw.Src, nil)
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, target, &jpeg.Options{Quality: homeWallpaperQuality}); err != nil {
		return original, nil
	}
	return homeWallpaper{data: encoded.Bytes(), contentType: "image/jpeg"}, nil
}

// refillHomeWallpapers keeps the pool topped up for the lifetime of the
// process, backing off while the picture service is unavailable.
func refillHomeWallpapers() {
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
		homeWallpaperPool <- picture
	}
}

// StartHomeWallpaperPrefetch begins filling the pool so the first visitor
// after a restart is served from memory too. Only main starts it; requests
// never wait on the pool being filled. Safe to call repeatedly.
func StartHomeWallpaperPrefetch() {
	if homeWallpaperPrefetch <= 0 {
		return
	}
	homeWallpaperOnce.Do(func() {
		homeWallpaperPool = make(chan homeWallpaper, homeWallpaperPrefetch)
		go refillHomeWallpapers()
	})
}

func nextHomeWallpaper(ctx context.Context) (homeWallpaper, error) {
	if homeWallpaperPool == nil {
		// Prefetching never started; answer from the upstream directly.
		return fetchHomeWallpaper(ctx)
	}
	select {
	case picture := <-homeWallpaperPool:
		return picture, nil
	default:
	}
	// The pool is empty — a burst drained it, or the refiller is backing off
	// after upstream failures. Answer from the upstream directly so the page
	// fails (or succeeds) with the upstream's own latency instead of holding
	// the request open on a channel until its context expires.
	return fetchHomeWallpaper(ctx)
}

func GetHomeWallpaper(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), homeWallpaperTimeout)
	defer cancel()
	picture, err := nextHomeWallpaper(ctx)
	if err != nil {
		common.SysLog("home wallpaper fetch failed: " + err.Error())
		c.Status(http.StatusBadGateway)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, picture.contentType, picture.data)
}
