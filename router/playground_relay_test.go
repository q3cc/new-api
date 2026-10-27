package router

import (
	"net/http"
	"reflect"
	"runtime"
	"slices"
	"strings"
	"testing"
	"unsafe"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Playground chat goes through the same per-user model request limiter as
// the API, and the limiter runs before a channel is chosen for the request.
func TestPlaygroundRelayRouteRunsTheRequestLimiterBeforeDistribution(t *testing.T) {
	engine := newAccessTokenScopeTestEngine(t)
	names := routeHandlerNames(engine, http.MethodPost, "/pg/chat/completions")
	require.NotEmpty(t, names)
	limiter := slices.IndexFunc(names, func(name string) bool { return strings.Contains(name, "ModelRequestRateLimit") })
	distribute := slices.IndexFunc(names, func(name string) bool { return strings.Contains(name, "Distribute") })
	require.NotEqual(t, -1, limiter, "no request limiter on the playground route: %v", names)
	require.NotEqual(t, -1, distribute)
	assert.Less(t, limiter, distribute)
}

// routeHandlerNames lists the handler chain of one route. gin keeps the chain
// only in its routing tree, so the unexported tree is walked here.
func routeHandlerNames(engine *gin.Engine, method, path string) []string {
	unexported := func(value reflect.Value, name string) reflect.Value {
		field := value.FieldByName(name)
		return reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem()
	}
	var names []string
	var walk func(node reflect.Value)
	walk = func(node reflect.Value) {
		if node.IsNil() || names != nil {
			return
		}
		if unexported(node.Elem(), "fullPath").String() == path {
			handlers := unexported(node.Elem(), "handlers")
			if handlers.Len() > 0 {
				for i := range handlers.Len() {
					names = append(names, runtime.FuncForPC(handlers.Index(i).Pointer()).Name())
				}
				return
			}
		}
		children := unexported(node.Elem(), "children")
		for i := range children.Len() {
			walk(children.Index(i))
		}
	}
	trees := unexported(reflect.ValueOf(engine).Elem(), "trees")
	for i := range trees.Len() {
		if unexported(trees.Index(i), "method").String() == method {
			walk(unexported(trees.Index(i), "root"))
		}
	}
	return names
}
