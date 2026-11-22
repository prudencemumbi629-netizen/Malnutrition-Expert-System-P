FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY schema.py server.py ./
COPY artifacts/model.joblib artifacts/model.joblib
USER 65532:65532
ENV HOST=0.0.0.0 PORT=8000 PYTHONDONTWRITEBYTECODE=1
EXPOSE 8000
CMD ["python", "server.py"]
