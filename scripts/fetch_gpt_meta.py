import json
import sys
import os
from pathlib import Path
from openai import OpenAI

# -----------------------------
# Step 1: Get JSON file path
# -----------------------------
def get_json_file_path():
    """
    Retrieves the JSON file path from the command line arguments.
    Exits the script if no argument is provided or the file does not exist.
    Returns:
        Path object pointing to the JSON file.
    """
    if len(sys.argv) < 2:
        print("Usage: python fetch_gpt_meta.py <path_to_json_file>")
        sys.exit(1)

    json_file_path = Path(sys.argv[1])
    if not json_file_path.is_file():
        print(f"File not found: {json_file_path}")
        sys.exit(1)

    return json_file_path

json_file_path = get_json_file_path()

# -----------------------------
# Step 2: Load config and OpenAI API key
# -----------------------------
APP_DATA_DIR = Path(os.getenv("APPDATA", ".")) / "metadata-filler-v3"
CONFIG_PATH = APP_DATA_DIR / "config.json"

if not CONFIG_PATH.is_file():
    print(f"Config file not found: {CONFIG_PATH}")
    sys.exit(1)

with open(CONFIG_PATH, "r", encoding="utf-8") as f:
    config = json.load(f)

api_key = config.get("openai_credentials", {}).get("api_key")
if not api_key:
    print("API key not found in config file.")
    sys.exit(1)

client = OpenAI(api_key=api_key)

# -----------------------------
# Step 3: Load input JSON
# -----------------------------
with open(json_file_path, "r", encoding="utf-8") as f:
    data = json.load(f)

# -----------------------------
# Step 3b: Merge tracklist into Tracks if needed
# -----------------------------
if "tracklist" in data:
    if "Tracks" not in data:
        data["Tracks"] = data["tracklist"]
    else:
        # Merge without duplicates
        existing_urls = {t.get("url") for t in data["Tracks"]}
        for track in data["tracklist"]:
            if track.get("url") not in existing_urls:
                data["Tracks"].append(track)
    # Remove the old tracklist key
    del data["tracklist"]

# -----------------------------
# Step 4: Query GPT for album metadata
# -----------------------------
prompt = f"""
You are a strict music metadata assistant.

INSTRUCTIONS:
- Fill in all missing metadata for the album.
- Return ONLY a single valid JSON object with these exact keys:
contributing_artist, genre, rating, comments, publisher, encoded_by,
parental_rating_reason, composers, conductors, group_description, mood, part_of_set, protected.
- Do not include any explanation, notes, or extra text outside the JSON.
- Leave empty strings "" or zeros 0 for unknown values.
- Lists such as contributing_artist, composers, or conductors must be returned as JSON arrays.
- Keep the JSON valid and parsable.

EXISTING DATA:
{json.dumps(data)}
"""

try:
    response = client.chat.completions.create(
        model="gpt-5-mini",
        messages=[
            {"role": "system", "content": "You are a helpful metadata assistant."},
            {"role": "user", "content": prompt}
        ]
    )
    raw_content = response.choices[0].message.content.strip()
    start = raw_content.find("{")
    end = raw_content.rfind("}") + 1
    if start == -1 or end == -1:
        print("Warning: No JSON found for album")
        album_metadata = {}
    else:
        album_metadata = json.loads(raw_content[start:end])
except Exception as e:
    print(f"Error fetching album metadata: {e}")
    album_metadata = {}

# Merge album metadata safely
data.update({
    "contributing_artist": album_metadata.get("contributing_artist", []),
    "genre": album_metadata.get("genre", data.get("Genre", "")),
    "rating": album_metadata.get("rating", 0),
    "comments": album_metadata.get("comments", ""),
    "publisher": album_metadata.get("publisher", ""),
    "encoded_by": album_metadata.get("encoded_by", ""),
    "parental_rating_reason": album_metadata.get("parental_rating_reason", ""),
    "composers": album_metadata.get("composers", []),
    "conductors": album_metadata.get("conductors", []),
    "group_description": album_metadata.get("group_description", ""),
    "mood": album_metadata.get("mood", ""),
    "part_of_set": album_metadata.get("part_of_set", 0),
    "protected": album_metadata.get("protected", False),
})

# -----------------------------
# Step 5: Save updated JSON
# -----------------------------
with open(json_file_path, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=4)

print(f"Album metadata updated and saved to {json_file_path}")
