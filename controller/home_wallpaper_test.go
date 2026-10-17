package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

var pngMagic = []byte("\x89PNG\r\n\x1a\n")

func serveHomeWallpaper(t *testing.T, upstreamURL string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	service.InitHttpClient()
	original := homeWallpaperURL
	homeWallpaperURL = upstreamURL
	t.Cleanup(func() { homeWallpaperURL = original })
	router := gin.New()
	router.GET("/api/home/wallpaper", GetHomeWallpaper)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/home/wallpaper", nil))
	return recorder
}

func TestHomeWallpaperFollowsRedirectAndSniffsImageType(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/l":
			http.Redirect(w, r, "/landscape/16.webp", http.StatusTemporaryRedirect)
		case "/landscape/16.webp":
			w.Header().Set("Content-Type", "application/octet-stream")
			_, _ = w.Write(append(append([]byte{}, pngMagic...), []byte("picture")...))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer upstream.Close()
	recorder := serveHomeWallpaper(t, upstream.URL+"/l")
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, "image/png", recorder.Header().Get("Content-Type"))
	assert.Equal(t, "no-store", recorder.Header().Get("Cache-Control"))
	assert.Equal(t, "nosniff", recorder.Header().Get("X-Content-Type-Options"))
	assert.True(t, strings.HasSuffix(recorder.Body.String(), "picture"))
}

func TestHomeWallpaperRejectsNonImageForeignRedirectAndUpstreamErrors(t *testing.T) {
	elsewhere := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("the wallpaper proxy must not follow redirects off the picture host")
	}))
	defer elsewhere.Close()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/html":
			_, _ = w.Write([]byte("<html><body>not an image</body></html>"))
		case "/elsewhere":
			http.Redirect(w, r, elsewhere.URL+"/picture.png", http.StatusTemporaryRedirect)
		default:
			w.WriteHeader(http.StatusServiceUnavailable)
		}
	}))
	defer upstream.Close()
	for _, path := range []string{"/html", "/elsewhere", "/down"} {
		recorder := serveHomeWallpaper(t, upstream.URL+path)
		assert.Equal(t, http.StatusBadGateway, recorder.Code, path)
		assert.Empty(t, recorder.Body.String(), path)
	}
}
