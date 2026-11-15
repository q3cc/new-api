package model

import (
	"crypto/rand"
	"encoding/base64"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
)

// The largest document the playground accepts, hard to compress, survives
// archiving, also when many are packed and unpacked at once.
func TestPlaygroundArchiveRoundTripAtTheDocumentLimit(t *testing.T) {
	noise := make([]byte, PlaygroundDocumentLimit*3/4)
	_, err := rand.Read(noise)
	require.NoError(t, err)
	text := base64.StdEncoding.EncodeToString(noise)
	document := []byte(`{"messages":[],"draft":"` + text[:PlaygroundDocumentLimit-40] + `"}`)
	document = document[:len(document)-2]
	for len(document) < PlaygroundDocumentLimit-2 {
		document = append(document, 'a')
	}
	document = append(document, '"', '}')
	require.Len(t, document, PlaygroundDocumentLimit)
	var wait sync.WaitGroup
	for range 4 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			packed := playgroundArchiveEncoder.EncodeAll(document, nil)
			row := PlaygroundConversation{ArchivedAt: 1, ArchivedContent: packed}
			restored, err := row.document()
			if err != nil || string(restored) != string(document) {
				t.Errorf("round trip failed: %v (packed %d bytes)", err, len(packed))
			}
		}()
	}
	wait.Wait()
	for _, small := range []string{`{}`, `{"messages":[]}`} {
		row := PlaygroundConversation{ArchivedAt: 1, ArchivedContent: playgroundArchiveEncoder.EncodeAll([]byte(small), nil)}
		restored, err := row.document()
		require.NoError(t, err)
		require.Equal(t, small, string(restored))
	}
}
