package model

import (
	"errors"
	"strings"

	"gorm.io/gorm/clause"
)

// Limits are playground planning budgets, not pricing or upstream validation.
// Provider documentation was checked on 2026-10-13. Keep aliases explicit: an
// arbitrary similarly named model must not inherit a guessed context window.
type PlaygroundModelCapability struct {
	Model              string `json:"model"`
	ContextWindow      int    `json:"context_window"`
	InputLimit         int    `json:"input_limit"`
	OutputLimit        int    `json:"output_limit"`
	TextGeneration     bool   `json:"text_generation"`
	CompressionWarning bool   `json:"compression_warning"`
}

func GetPlaygroundModelCapability(name string) PlaygroundModelCapability {
	c := PlaygroundModelCapability{Model: name}
	switch strings.ToLower(name) {
	case "claude-opus-4-6", "claude-opus-4-6-thinking", "claude-opus-5-5":
		c.ContextWindow, c.OutputLimit = 1000000, 128000
	case "deepseek-v3.1", "deepseek.v3.1":
		c.ContextWindow, c.OutputLimit, c.CompressionWarning = 128000, 8000, true
	case "deepseek-v3.2", "deepseek.v3.2":
		c.ContextWindow, c.OutputLimit, c.CompressionWarning = 163840, 8000, true
	case "deepseek-v4-pro-preview", "deepseek/deepseek-v4-pro":
		// OpenRouter routes include both 1,000,000 and 1,048,576 windows.
		c.ContextWindow = 1000000
	case "gemini-3.1-pro", "gemini-3.1-pro-preview", "gemini-3.8-flash":
		c.InputLimit, c.OutputLimit = 1048576, 65536
	case "gemma-4-31b", "google.gemma-4-31b":
		c.ContextWindow = 256000
	case "gpt-4o", "gpt-4o-mini":
		c.ContextWindow, c.OutputLimit = 128000, 16384
	case "grok-4.3", "xai.grok-4.3":
		c.ContextWindow = 1000000
	case "grok-4.6", "xai.grok-4.6":
		c.ContextWindow = 500000
	}
	c.TextGeneration = c.ContextWindow > 0 || c.InputLimit > 0
	return c
}

type PlaygroundCompressionSettings struct {
	Model     string `json:"model"`
	Group     string `json:"group,omitempty"`
	Automatic bool   `json:"automatic"`
}

type PlaygroundPreference struct {
	UserId           int    `json:"-" gorm:"primaryKey;autoIncrement:false"`
	Model            string `json:"model" gorm:"size:255;not null"`
	CompressionGroup string `json:"group" gorm:"size:64"`
	Automatic        bool   `json:"automatic" gorm:"not null"`
	Revision         int64  `json:"revision" gorm:"not null"`
	LastOperation    string `json:"-" gorm:"size:64;not null"`
}

type PlaygroundPreferenceWrite struct {
	PlaygroundCompressionSettings
	Revision    int64  `json:"revision"`
	OperationId string `json:"operation_id"`
}

var ErrPlaygroundSettingsInvalid = errors.New("Invalid compression settings")

func (s PlaygroundCompressionSettings) Validate() error {
	if len(s.Group) > 64 || strings.TrimSpace(s.Group) != s.Group {
		return ErrPlaygroundSettingsInvalid
	}
	if s.Model == "" && !s.Automatic {
		return nil
	}
	if len(s.Model) > 255 || !GetPlaygroundModelCapability(s.Model).TextGeneration {
		return ErrPlaygroundSettingsInvalid
	}
	return nil
}

func GetPlaygroundPreference(userId int) (*PlaygroundPreference, error) {
	row := PlaygroundPreference{UserId: userId}
	err := playgroundDB().Where("user_id = ?", userId).Find(&row).Error
	return &row, err
}

func SavePlaygroundPreference(userId int, write PlaygroundPreferenceWrite) (*PlaygroundPreference, error) {
	if err := write.PlaygroundCompressionSettings.Validate(); err != nil {
		return nil, err
	}
	if write.Revision < 0 || len(write.OperationId) < 16 || len(write.OperationId) > 64 {
		return nil, ErrPlaygroundSettingsInvalid
	}
	row := PlaygroundPreference{UserId: userId}
	if err := playgroundDB().Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
		return nil, err
	}
	err := playgroundDB().Model(&row).Where("user_id = ? AND revision = ? AND last_operation <> ?", userId, write.Revision, write.OperationId).Updates(map[string]any{
		"model": write.Model, "compression_group": write.Group, "automatic": write.Automatic, "revision": write.Revision + 1, "last_operation": write.OperationId,
	}).Error
	if err != nil {
		return nil, err
	}
	stored, err := GetPlaygroundPreference(userId)
	if err != nil {
		return nil, err
	}
	if stored.LastOperation != write.OperationId || stored.Model != write.Model || stored.CompressionGroup != write.Group || stored.Automatic != write.Automatic {
		return nil, ErrPlaygroundConflict
	}
	return stored, nil
}

type PlaygroundCompression struct {
	Summary    string `json:"summary"`
	Boundary   string `json:"boundary"`
	SourceHash string `json:"sourceHash"`
	Model      string `json:"model"`
	Group      string `json:"group,omitempty"`
	CreatedAt  int64  `json:"createdAt"`
}
