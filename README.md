# PathDesigner

Node-based CAM system built with React Flow + FastAPI.

STEP input → Toolpath generation → OpenSBP output (ShopBot)

## Setup

### Backend

```bash
cd backend
uv sync
uv run uvicorn main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173
