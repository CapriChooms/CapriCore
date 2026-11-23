"""Cheap script validation before an English-only model sees unsupported tokens."""
import unicodedata


def validate_speech_language(text, language):
    if language != 'en':
        return
    letters = [char for char in text if char.isalpha()]
    foreign = sum('LATIN' not in unicodedata.name(char, '') for char in letters)
    if foreign >= 3 and foreign * 4 >= len(letters):
        raise ValueError('English voice requires English reply text; select a matching conversation and spoken language.')
