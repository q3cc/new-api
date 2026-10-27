package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestPlaygroundPacketWarningOnlyBelowTheDocumentLimit(t *testing.T) {
	needed := int64(PlaygroundDocumentLimit + playgroundPacketHeadroom)
	_, warn := playgroundPacketWarning(needed)
	assert.False(t, warn, "a packet that fits a conversation and its statement needs no warning")
	_, warn = playgroundPacketWarning(0)
	assert.False(t, warn, "an unknown value is not reported as too small")
	text, warn := playgroundPacketWarning(4 * 1024 * 1024)
	assert.True(t, warn)
	assert.Contains(t, text, "4194304")
	assert.Contains(t, text, "9437184")
}
