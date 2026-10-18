package main

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInjectHomeWallpaperPreloadFollowsTheHomePageSetting(t *testing.T) {
	originalPage := indexPage
	t.Cleanup(func() { indexPage = originalPage })

	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	}
	previous := common.OptionMap["HomePageContent"]
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap["HomePageContent"] = previous
		common.OptionMapRWMutex.Unlock()
	})

	fixture := []byte("<head>\n" +
		"    <!--home-wallpaper-preload-->\n" +
		"    <script>preload()</script>\n" +
		"    <!--/home-wallpaper-preload-->\n" +
		"    <!--umami-->\n" +
		"  </head>\n")
	for _, tc := range []struct {
		name    string
		content string
		kept    bool
	}{
		{name: "built-in home page keeps the preload", content: "", kept: true},
		{name: "whitespace-only content keeps the preload", content: "  \n", kept: true},
		{name: "custom home page drops the preload", content: "https://example.com", kept: false},
		{name: "custom html content drops the preload", content: "<h1>Welcome</h1>", kept: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			indexPage = append([]byte(nil), fixture...)
			common.OptionMapRWMutex.Lock()
			common.OptionMap["HomePageContent"] = tc.content
			common.OptionMapRWMutex.Unlock()

			InjectHomeWallpaperPreload()

			page := string(indexPage)
			if tc.kept {
				assert.Contains(t, page, "<!--home-wallpaper-preload-->")
				assert.Contains(t, page, "<script>preload()</script>")
			} else {
				assert.NotContains(t, page, "home-wallpaper-preload")
				assert.NotContains(t, page, "preload()")
			}
			// The rest of the head is untouched either way.
			assert.Contains(t, page, "<!--umami-->")
			assert.Contains(t, page, "</head>")
		})
	}
}

func TestInjectHomeWallpaperPreloadLeavesAPageWithoutMarkersAlone(t *testing.T) {
	originalPage := indexPage
	t.Cleanup(func() { indexPage = originalPage })
	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	}
	previous := common.OptionMap["HomePageContent"]
	common.OptionMap["HomePageContent"] = "custom home"
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap["HomePageContent"] = previous
		common.OptionMapRWMutex.Unlock()
	})

	indexPage = []byte("<head><script>app()</script></head>")
	require.NotEmpty(t, indexPage)
	InjectHomeWallpaperPreload()
	assert.Equal(t, "<head><script>app()</script></head>", string(indexPage))
}
