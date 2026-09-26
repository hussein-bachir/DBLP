"""Write the FastAPI app's OpenAPI schema to frontend/openapi.json.

    python export_openapi.py

The React app generates its TypeScript API types from that file
(`npm run gen:api` in frontend/), so the front end and the backend models can't
drift apart unnoticed. Re-run both after changing api.py.
"""
import json
from pathlib import Path

from api import app

OUT = Path(__file__).resolve().parent.parent / "frontend" / "openapi.json"


def main():
    OUT.write_text(json.dumps(app.openapi(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
