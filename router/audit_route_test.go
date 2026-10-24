package router

import (
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"unsafe"

	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Every administrator write route leaves an audit log the console can
// translate: either its handler records its own entry, which skips the
// fallback, or the fallback names the action. A route that does neither is
// shown as a raw "METHOD /api/..." line.
func TestAdminWriteRoutesNameTheirAuditAction(t *testing.T) {
	engine := newAccessTokenScopeTestEngine(t)
	selfAudited := controllerFuncsReaching(t, "markAuditLogged")
	routes := 0
	for _, route := range adminWriteRoutes(engine) {
		routes++
		if selfAudited[route.handler] {
			continue
		}
		assert.NotEmpty(t, middleware.AuditRouteAction(route.method, route.path),
			"%s %s (%s) needs an entry in middleware auditRouteActions and a frontend audit template", route.method, route.path, route.handler)
	}
	require.NotZero(t, routes, "no administrator write routes were found")
}

type adminWriteRoute struct {
	method  string
	path    string
	handler string
}

// adminWriteRoutes lists the write routes that pass AdminAuth or RootAuth.
// gin keeps each route's handler chain only in its unexported routing tree.
func adminWriteRoutes(engine *gin.Engine) []adminWriteRoute {
	unexported := func(value reflect.Value, name string) reflect.Value {
		field := value.FieldByName(name)
		return reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem()
	}
	var routes []adminWriteRoute
	var walk func(method string, node reflect.Value)
	walk = func(method string, node reflect.Value) {
		if node.IsNil() {
			return
		}
		handlers := unexported(node.Elem(), "handlers")
		admin := false
		handler := ""
		for i := range handlers.Len() {
			handler = runtime.FuncForPC(handlers.Index(i).Pointer()).Name()
			admin = admin || strings.Contains(handler, "middleware.AdminAuth") || strings.Contains(handler, "middleware.RootAuth")
		}
		if admin {
			routes = append(routes, adminWriteRoute{
				method:  method,
				path:    unexported(node.Elem(), "fullPath").String(),
				handler: strings.TrimSuffix(handler[strings.LastIndex(handler, ".")+1:], "-fm"),
			})
		}
		children := unexported(node.Elem(), "children")
		for i := range children.Len() {
			walk(method, children.Index(i))
		}
	}
	trees := unexported(reflect.ValueOf(engine).Elem(), "trees")
	for i := range trees.Len() {
		method := unexported(trees.Index(i), "method").String()
		if method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions {
			continue
		}
		walk(method, unexported(trees.Index(i), "root"))
	}
	return routes
}

// controllerFuncsReaching returns the controller functions that call target
// directly or through other controller functions.
func controllerFuncsReaching(t *testing.T, target string) map[string]bool {
	t.Helper()
	files, err := filepath.Glob("../controller/*.go")
	require.NoError(t, err)
	calls := map[string]map[string]bool{}
	fileSet := token.NewFileSet()
	for _, file := range files {
		if strings.HasSuffix(file, "_test.go") {
			continue
		}
		parsed, err := parser.ParseFile(fileSet, file, nil, 0)
		require.NoError(t, err)
		for _, declaration := range parsed.Decls {
			function, ok := declaration.(*ast.FuncDecl)
			if !ok || function.Recv != nil || function.Body == nil {
				continue
			}
			callees := map[string]bool{}
			ast.Inspect(function.Body, func(node ast.Node) bool {
				if call, ok := node.(*ast.CallExpr); ok {
					if name, ok := call.Fun.(*ast.Ident); ok {
						callees[name.Name] = true
					}
				}
				return true
			})
			calls[function.Name.Name] = callees
		}
	}
	require.Contains(t, calls, target)
	reaching := map[string]bool{target: true}
	for changed := true; changed; {
		changed = false
		for name, callees := range calls {
			if reaching[name] {
				continue
			}
			for callee := range callees {
				if reaching[callee] {
					reaching[name] = true
					changed = true
					break
				}
			}
		}
	}
	return reaching
}
