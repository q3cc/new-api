package controller

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var pngMagic = []byte("\x89PNG\r\n\x1a\n")

func fetchTestWallpaper(t *testing.T, upstreamURL string) (*homeWallpaper, error) {
	t.Helper()
	service.InitHttpClient()
	original := homeWallpaperURL
	homeWallpaperURL = upstreamURL
	t.Cleanup(func() { homeWallpaperURL = original })
	return fetchHomeWallpaper(t.Context())
}

// useHomeWallpapers replaces the served picture set for one test and keeps the
// background rotation from starting.
func useHomeWallpapers(t *testing.T, pictures ...*homeWallpaper) {
	t.Helper()
	homeWallpaperMu.Lock()
	previous := homeWallpaperPictures
	homeWallpaperPictures = pictures
	homeWallpaperMu.Unlock()
	originalSize := homeWallpaperPoolSize
	homeWallpaperPoolSize = 0
	t.Cleanup(func() {
		homeWallpaperMu.Lock()
		homeWallpaperPictures = previous
		homeWallpaperMu.Unlock()
		homeWallpaperPoolSize = originalSize
	})
}

func serveWallpaperRoute(path string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/api/home/wallpaper", GetHomeWallpaper)
	router.GET("/api/home/wallpaper/:id", GetHomeWallpaperImage)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
	return recorder
}

func encodedTestPicture(t *testing.T, width, height int) []byte {
	t.Helper()
	picture := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := range height {
		for x := range width {
			picture.Set(x, y, color.RGBA{R: uint8(x / 16), G: uint8(y / 12), B: 128, A: 255})
		}
	}
	var encoded bytes.Buffer
	require.NoError(t, png.Encode(&encoded, picture))
	return encoded.Bytes()
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
	picture, err := fetchTestWallpaper(t, upstream.URL+"/l")
	require.NoError(t, err)
	assert.Len(t, picture.id, 16)
	for _, width := range homeWallpaperWidths {
		variant := picture.variants[width]
		assert.Equal(t, "image/png", variant.contentType, width)
		assert.True(t, strings.HasSuffix(string(variant.data), "picture"), "undecodable pictures pass through")
	}
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
		case "/huge":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(hugePngHeader(30000, 30000))
		default:
			w.WriteHeader(http.StatusServiceUnavailable)
		}
	}))
	defer upstream.Close()
	for _, path := range []string{"/html", "/elsewhere", "/down", "/huge"} {
		picture, err := fetchTestWallpaper(t, upstream.URL+path)
		assert.Error(t, err, path)
		assert.Nil(t, picture, path)
	}
}

func TestHomeWallpaperKeepsAScaledJPEGPerServedWidth(t *testing.T) {
	large := encodedTestPicture(t, 4000, 3000)
	picture, err := newHomeWallpaper(large, "image/png")
	require.NoError(t, err)
	for width, wantHeight := range map[int]int{1280: 960, 1920: 1440} {
		variant := picture.variants[width]
		assert.Equal(t, "image/jpeg", variant.contentType)
		config, format, err := image.DecodeConfig(bytes.NewReader(variant.data))
		require.NoError(t, err)
		assert.Equal(t, "jpeg", format)
		assert.Equal(t, width, config.Width)
		assert.Equal(t, wantHeight, config.Height)
		assert.Less(t, len(variant.data), len(large))
	}
	assert.Less(t, len(picture.variants[1280].data), len(picture.variants[1920].data), "small screens download less")

	// A picture that already fits a width is served as-is for it.
	medium := encodedTestPicture(t, 1600, 900)
	picture, err = newHomeWallpaper(medium, "image/png")
	require.NoError(t, err)
	assert.Equal(t, medium, picture.variants[1920].data)
	assert.Equal(t, "image/jpeg", picture.variants[1280].contentType)
}

// hugePngHeader builds a PNG that declares the given dimensions in its IHDR
// without any pixel data, so DecodeConfig reports the size a decode would
// allocate without the test allocating it.
func hugePngHeader(width, height int) []byte {
	var buf bytes.Buffer
	buf.WriteString("\x89PNG\r\n\x1a\n")
	chunk := func(typ string, data []byte) {
		var length [4]byte
		binary.BigEndian.PutUint32(length[:], uint32(len(data)))
		buf.Write(length[:])
		buf.WriteString(typ)
		buf.Write(data)
		var crc [4]byte
		binary.BigEndian.PutUint32(crc[:], crc32.ChecksumIEEE(append([]byte(typ), data...)))
		buf.Write(crc[:])
	}
	ihdr := make([]byte, 13)
	binary.BigEndian.PutUint32(ihdr[0:4], uint32(width))
	binary.BigEndian.PutUint32(ihdr[4:8], uint32(height))
	ihdr[8] = 8 // bit depth
	ihdr[9] = 2 // truecolor
	chunk("IHDR", ihdr)
	chunk("IEND", nil)
	return buf.Bytes()
}

func TestHomeWallpaperRotationRetiresTheOldestAndSkipsDuplicates(t *testing.T) {
	useHomeWallpapers(t)
	pictures := []*homeWallpaper{{id: "a"}, {id: "b"}, {id: "c"}}
	assert.False(t, addHomeWallpaper(pictures[0], 2))
	assert.True(t, addHomeWallpaper(pictures[1], 2))
	assert.True(t, addHomeWallpaper(&homeWallpaper{id: "a"}, 2), "a picture already served is not added twice")
	assert.True(t, addHomeWallpaper(pictures[2], 2))
	assert.Equal(t, []*homeWallpaper{pictures[1], pictures[2]}, homeWallpaperPictures)
}

func TestHomeWallpaperFailsFastBeforeTheFirstPictureArrives(t *testing.T) {
	useHomeWallpapers(t)
	recorder := serveWallpaperRoute("/api/home/wallpaper")
	assert.Equal(t, http.StatusServiceUnavailable, recorder.Code)
	assert.Equal(t, "no-store", recorder.Header().Get("Cache-Control"))
}

func TestHomeWallpaperRedirectsToACacheableVariantForTheViewport(t *testing.T) {
	picture := &homeWallpaper{id: "0123456789abcdef", variants: map[int]homeWallpaperVariant{
		1280: {data: []byte("small"), contentType: "image/jpeg"},
		1920: {data: []byte("large"), contentType: "image/jpeg"},
	}}
	useHomeWallpapers(t, picture)
	for query, want := range map[string]string{
		"?w=390":  "/api/home/wallpaper/0123456789abcdef?w=1280",
		"?w=1280": "/api/home/wallpaper/0123456789abcdef?w=1280",
		"?w=1281": "/api/home/wallpaper/0123456789abcdef?w=1920",
		"?w=5000": "/api/home/wallpaper/0123456789abcdef?w=1920",
		"?w=abc":  "/api/home/wallpaper/0123456789abcdef?w=1920",
		"":        "/api/home/wallpaper/0123456789abcdef?w=1920",
	} {
		recorder := serveWallpaperRoute("/api/home/wallpaper" + query)
		assert.Equal(t, http.StatusFound, recorder.Code, query)
		assert.Equal(t, want, recorder.Header().Get("Location"), query)
		assert.Equal(t, "no-store", recorder.Header().Get("Cache-Control"), "the random pick itself is never cached")
	}

	recorder := serveWallpaperRoute("/api/home/wallpaper/0123456789abcdef?w=1280")
	require.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, "small", recorder.Body.String())
	assert.Equal(t, "image/jpeg", recorder.Header().Get("Content-Type"))
	assert.Equal(t, homeWallpaperCacheControl, recorder.Header().Get("Cache-Control"))
	assert.Equal(t, "nosniff", recorder.Header().Get("X-Content-Type-Options"))
	etag := recorder.Header().Get("ETag")
	require.NotEmpty(t, etag)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/api/home/wallpaper/:id", GetHomeWallpaperImage)
	revalidate := httptest.NewRequest(http.MethodGet, "/api/home/wallpaper/0123456789abcdef?w=1280", nil)
	revalidate.Header.Set("If-None-Match", etag)
	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, revalidate)
	assert.Equal(t, http.StatusNotModified, recorder.Code)
	assert.Empty(t, recorder.Body.String())

	recorder = serveWallpaperRoute("/api/home/wallpaper/ffffffffffffffff?w=1280")
	assert.Equal(t, http.StatusNotFound, recorder.Code, "a retired picture is gone")
	assert.Equal(t, "no-store", recorder.Header().Get("Cache-Control"))
}

func TestHomeWallpaperRotationStaysOffForACustomHomePage(t *testing.T) {
	originalStart, originalSize := startHomeWallpaperRotation, homeWallpaperPoolSize
	var starts int
	startHomeWallpaperRotation = func() { starts++ }
	homeWallpaperPoolSize = 1
	homeWallpaperOnce = sync.Once{}
	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	}
	homePageContent := common.OptionMap["HomePageContent"]
	common.OptionMap["HomePageContent"] = "custom home"
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		startHomeWallpaperRotation, homeWallpaperPoolSize = originalStart, originalSize
		homeWallpaperOnce = sync.Once{}
		common.OptionMapRWMutex.Lock()
		common.OptionMap["HomePageContent"] = homePageContent
		common.OptionMapRWMutex.Unlock()
	})
	// The custom home page never requests the wallpaper, so nothing is fetched.
	StartHomeWallpaperPrefetch()
	assert.Equal(t, 0, starts)

	common.OptionMapRWMutex.Lock()
	common.OptionMap["HomePageContent"] = ""
	common.OptionMapRWMutex.Unlock()
	StartHomeWallpaperPrefetch()
	StartHomeWallpaperPrefetch()
	assert.Equal(t, 1, starts, "the rotation starts once")
}
