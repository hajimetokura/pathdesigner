.PHONY: dev back front

# Backend + Frontend simultaneous start
dev:
	@echo "Starting backend and frontend..."
	@make back & make front

# Backend only
back:
	cd backend && uv run uvicorn main:app --reload

# Frontend only
front:
	cd frontend && npm run dev
