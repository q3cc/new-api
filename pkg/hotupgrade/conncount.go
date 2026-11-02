package hotupgrade

import (
	"net"
	"net/http"
	"sync"
)

// ConnCounter counts the HTTP connections a server is busy on. Install Hook
// as http.Server.ConnState.
type ConnCounter struct {
	mu     sync.Mutex
	active map[net.Conn]struct{}
}

// Hook records a connection's state change.
func (c *ConnCounter) Hook(conn net.Conn, state http.ConnState) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.active == nil {
		c.active = map[net.Conn]struct{}{}
	}
	if state == http.StateActive {
		c.active[conn] = struct{}{}
		return
	}
	delete(c.active, conn)
}

// Busy returns how many connections are in the middle of a request.
func (c *ConnCounter) Busy() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.active)
}
