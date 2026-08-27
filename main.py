import os
import webview
from api import Api, WORKING_DIR

FRONTEND_INDEX = os.path.join(os.path.dirname(__file__), "index.html")


def cleanup_working_dir():
    """
    Deletes anything left in the working directory when the app closes -
    generated maps that were never delivered don't persist between runs.
    """
    for fname in os.listdir(WORKING_DIR):
        fpath = os.path.join(WORKING_DIR, fname)
        try:
            if os.path.isfile(fpath):
                os.remove(fpath)
        except OSError:
            pass  # best-effort cleanup, not worth failing app shutdown over


if __name__ == "__main__":
    api = Api()
    window = webview.create_window(
        "PBR Texture Converter",
        FRONTEND_INDEX,
        js_api=api,
        width=1200,
        height=800,
    )
    window.events.closed += cleanup_working_dir
    webview.start(debug=True)