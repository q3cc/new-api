package controller

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// The random wallpaper service sends no CORS headers, so the browser cannot
// upload it as a WebGL texture. Serving it same-origin lets the home page fetch
// one picture and share it between the CSS backdrop and the glass shader.
var homeWallpaperURL = "https://randpic.esa.starcity.ink/l"

const (
	homeWallpaperTimeout  = 15 * time.Second
	maxHomeWallpaperBytes = 16 << 20
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

func GetHomeWallpaper(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), homeWallpaperTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, homeWallpaperURL, nil)
	if err != nil {
		c.Status(http.StatusBadGateway)
		return
	}
	req.Header.Set("Accept", "image/webp,image/*;q=0.8")
	resp, err := homeWallpaperClient().Do(req)
	if err != nil {
		common.SysLog("home wallpaper fetch failed: " + err.Error())
		c.Status(http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		c.Status(http.StatusBadGateway)
		return
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxHomeWallpaperBytes+1))
	if err != nil || len(data) == 0 || len(data) > maxHomeWallpaperBytes {
		c.Status(http.StatusBadGateway)
		return
	}
	// The upstream labels pictures application/octet-stream; sniff the bytes
	// so only images reach the browser under an image content type.
	contentType := http.DetectContentType(data)
	if !strings.HasPrefix(contentType, "image/") {
		c.Status(http.StatusBadGateway)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, contentType, data)
}
