#!/bin/bash
echo "Installing dependencies..."
pip install -r requirements.txt
echo "Starting Tuliprox Mapper on http://localhost:8765"
uvicorn main:app --host 0.0.0.0 --port 8765 --reload
