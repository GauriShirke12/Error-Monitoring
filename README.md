# 🚨 Error Monitoring System

A **production-grade error monitoring system** inspired by tools like **Sentry** and **LogRocket**, built from scratch to capture, group, analyze, and visualize runtime errors from real-world applications.

This platform helps developers understand **what broke, where it broke, how often it’s breaking, and in which environment**, without relying on user complaints or guesswork.

---

## 📌 Why This Project Exists

In real production systems:
- Users don’t send stack traces
- Errors spike unpredictably
- One bug can affect thousands of users
- Logging must **never crash the app**

This project solves that exact problem by:
- Capturing errors **directly from live applications**
- Grouping similar errors intelligently
- Providing actionable analytics & alerts
- Ensuring **zero impact** on client performance

---

## 🏗 High-Level Architecture

<img width="1536" height="1024" alt="image" src="https://github.com/user-attachments/assets/e5fc4b8b-4db6-4af6-affc-641f63687a4b" />

---

## 🏗 work flow of project

<img width="1536" height="1024" alt="image" src="https://github.com/user-attachments/assets/c568ae84-68e7-4b2e-805d-d3522f415638" />


---

## 🔧 Core Features

### ✅ Client SDK (Browser + Node.js)
- Auto-capture uncaught errors (`window.onerror`, `unhandledrejection`)
- Manual error logging: `captureError(error, context)`
- Async batching & retry with exponential backoff
- Offline queue (localStorage for browser)
- Sampling support to reduce noise
- Lightweight & developer-friendly API

---

### ✅ Secure Error Ingestion API
- Rate-limited ingestion endpoint
- Silent failure (never breaks client apps)
- Schema validation & sanitization
- Sensitive data masking (tokens, passwords, secrets)
- Error fingerprinting using stack traces


---

### ✅ Developer Dashboard
- Real-time visibility into system health
- Drill down into individual errors
- Occurrence history with context & breadcrumbs
- Clean, actionable UI (no raw noise)

📸 Screenshots:

<img width="1570" height="1600" alt="image" src="https://github.com/user-attachments/assets/41c0f320-e0a5-4075-b868-ac238f69cfd6" />

---


**Overview** – High-level system health and error summary

<img width="1883" height="2800" alt="image" src="https://github.com/user-attachments/assets/494f1365-43d6-4c3d-945c-d874582a927c" />

---


### ✅ Intelligent Error Grouping
- Fingerprints errors using message + stack trace
- Stores:
  - First seen
  - Last seen
  - Occurrence count
  - Environment
- Prevents duplicate records for repeated errors

📸 Screenshot:
-<img width="1876" height="1466" alt="image" src="https://github.com/user-attachments/assets/4eec6b3e-68a9-4b74-9455-51760351ef8c" />


---

### ✅ Analytics & Aggregation
- Total errors & new errors (last 24h)
- Error trends (hourly / daily)
- Top recurring errors
- Environment-wise breakdown
- Cached analytics for performance

📸 Screenshots:


<img width="1877" height="3239" alt="image" src="https://github.com/user-attachments/assets/7f4cf0e8-d725-4f66-a8ba-9804a10eb469" />

---



## 🧠 System Design Highlights

- **Defensive Engineering:** logging failures never impact clients
- **Scalability:** handles 1000+ errors/min with batching & indexing
- **Performance:** API responses <200ms
- **Security:** OWASP best practices, masking, rate limiting
- **Reliability:** async queues, retries, offline persistence

---

## 🛠 Tech Stack

**Backend**
- Node.js, Express
- MongoDB + Aggregation Pipelines
- Winston logging
- Rate limiting & validation

**SDK**
- JavaScript (Browser + Node)
- Async queues & batching
- Error serialization & normalization

**Frontend**
- Dashboard UI (React)
- Analytics visualizations

---

## 🚀 Getting Started

### 1️⃣ Clone Repository
```bash
git clone https://github.com/your-username/error-monitoring-platform.git
cd error-monitoring-platform

---
## ⚙️ Installation & Setup

### 2️⃣ Install Dependencies
```bash
npm install

---

### 3️⃣ Environment Variables

Create a .env file in the root directory and add the following:

PORT=4000
MONGO_URI=your_mongodb_connection

---

### 4️⃣ Run the Server

Start the development server:

npm run dev
The server will start at:

http://localhost:4000
