//go:build !windows

package hotupgrade

import (
	"bufio"
	"context"
	"errors"
	"net"
	"os"
	"sync"

	"github.com/QuantumNous/new-api/common"
)

// Worker is this process's link to the supervisor that started it.
type Worker struct {
	control   net.Conn
	writeMu   sync.Mutex
	requestMu sync.Mutex
	replies   chan message
}

var (
	currentOnce   sync.Once
	currentWorker *Worker
)

// Current returns the link to the supervisor, or nil when this process was
// not started by one.
func Current() *Worker {
	currentOnce.Do(func() {
		if common.UpgradeWorkerGeneration() == 0 {
			return
		}
		file := os.NewFile(controlFD, "control")
		control, err := net.FileConn(file)
		_ = file.Close()
		if err != nil {
			return
		}
		currentWorker = &Worker{control: control, replies: make(chan message, 1)}
		go currentWorker.readReplies()
	})
	return currentWorker
}

// Listener returns the socket the supervisor listens on. Closing it stops
// only this worker from accepting; the other workers keep the socket open.
func (w *Worker) Listener() (net.Listener, error) {
	file := os.NewFile(listenerFD, "listener")
	defer file.Close()
	return net.FileListener(file)
}

// Ready tells the supervisor this worker is serving, so it can switch new
// connections over and drain the previous worker.
func (w *Worker) Ready() error {
	return w.send(message{Type: messageReady})
}

// ReportConnections tells the supervisor how many connections this worker
// still serves while it drains.
func (w *Worker) ReportConnections(count int) error {
	return w.send(message{Type: messageConnections, Count: count})
}

// RequestUpgrade asks the supervisor to switch to a verified binary. It
// returns once the supervisor accepted or refused; progress is then in
// ReadStatus.
func (w *Worker) RequestUpgrade(ctx context.Context, release Release) error {
	return w.request(ctx, message{Type: messageUpgrade, Version: release.Version, Path: release.Path, SHA256: release.SHA256})
}

// RequestRollback asks the supervisor to switch back to the previous binary.
func (w *Worker) RequestRollback(ctx context.Context) error {
	return w.request(ctx, message{Type: messageRollback})
}

func (w *Worker) request(ctx context.Context, msg message) error {
	w.requestMu.Lock()
	defer w.requestMu.Unlock()
	// Drop a reply left over from a request whose caller gave up waiting.
	select {
	case <-w.replies:
	default:
	}
	if err := w.send(msg); err != nil {
		return err
	}
	select {
	case reply, ok := <-w.replies:
		if !ok {
			return errors.New("the supervisor is gone")
		}
		if reply.Error != "" {
			return errors.New(reply.Error)
		}
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (w *Worker) send(msg message) error {
	data, err := common.Marshal(msg)
	if err != nil {
		return err
	}
	w.writeMu.Lock()
	defer w.writeMu.Unlock()
	_, err = w.control.Write(append(data, '\n'))
	return err
}

func (w *Worker) readReplies() {
	defer close(w.replies)
	scanner := bufio.NewScanner(w.control)
	for scanner.Scan() {
		var msg message
		if common.Unmarshal(scanner.Bytes(), &msg) != nil || msg.Type != messageReply {
			continue
		}
		select {
		case w.replies <- msg:
		default:
		}
	}
}
