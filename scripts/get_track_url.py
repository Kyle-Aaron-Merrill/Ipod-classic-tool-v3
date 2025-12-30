# Copyright (c) 2025 Kyle-Aaron-Merrill
# 
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
# 
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
# 
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

import sys
import json
from yt_dlp import YoutubeDL


def get_track_url(playlist_url, track_name):
    options = {
        'extract_flat': True,
        'dump_single_json': True,
        'quiet': True,
    }

    with YoutubeDL(options) as ydl:
        try:
            info = ydl.extract_info(playlist_url, download=False)
        except Exception as e:
            print(json.dumps({'url': None, 'error': str(e)}))
            return None

        # Handle flat playlist entries
        entries = info.get('entries')
        if entries:
            for entry in entries:
                title = entry.get('title', '').lower()
                if track_name.lower() in title:
                    return f"https://www.youtube.com/watch?v={entry.get('id')}"
        else:
            # Not a playlist, maybe a single video
            title = info.get('title', '').lower()
            if track_name.lower() in title:
                return f"https://www.youtube.com/watch?v={info.get('id')}"
            
            

    return None

if __name__ == "__main__":
    playlist_url = sys.argv[1] if len(sys.argv) > 1 else 'https://www.youtube.com/playlist?list=OLAK5uy_mp-BuWDQHAM9Up7syTjX3T_SQgC6PjgVA'
    track_name = sys.argv[2] if len(sys.argv) > 2 else 'I Gotta Feeling'
    
    result = get_track_url(playlist_url, track_name)
    print(json.dumps({'url': result}))

    
