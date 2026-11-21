import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";

const app = express();

app.use(helmet());

app.use(cors({
  origin: process.env.APP_URL ?? "http://localhost:5173",
  credentials: true
}));

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "BusinessOS API is running",
    timestamp: new Date().toISOString()
  });
});

const PORT = Number(process.env.PORT ?? 5000);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`BusinessOS API running on port ${PORT}`);
});
