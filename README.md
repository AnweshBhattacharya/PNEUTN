# Pneutn - AI Powered Calculus Visualiser

## 1. Overview and Live Demo
Pneutn is a robust, serverless backend designed to perform advanced mathematical computations, including equation solving, Riemann sum approximations, and integral-order calculations. By combining cloud-native AWS services with the Google Gemini 2.5 Flash API, the system not only calculates precise mathematical results but also provides intelligent, dynamic narrations of the problem-solving steps. 

**Live Demo / Frontend Application:** 
[Here you can access the Amplify deployed link](https://main.d374q6vzj4flmw.amplifyapp.com/)

---

## 2. How to Use
The backend exposes a REST-like HTTP API capable of handling cross-origin requests (CORS) from the specified Amplify domain.

### Available Endpoints
All primary math endpoints accept `POST` requests and support `OPTIONS` for CORS preflight.
- `/solve`: Evaluates and solves algebraic equations.
- `/riemann`: Calculates Riemann sum approximations for given functions.
- `/integral-order`: Computes integrations and related calculus operations.

### Example Request
Send a `POST` request to the desired endpoint with a JSON payload containing the mathematical expression and required parameters. If the `GeminiApiKey` is configured, the response will include a detailed, AI-generated narration of the solution alongside the deterministic computational result.

---

## 3. Tech Stack and Structure

### Core Technologies
- **Cloud Provider:** Amazon Web Services (AWS)
- **Infrastructure as Code (IaC):** AWS Serverless Application Model (SAM) / CloudFormation
- **Compute:** AWS Lambda (Python 3.11, `arm64` architecture for cost-performance optimization)
- **API Management:** Amazon API Gateway (HTTP API)
- **Mathematical Processing:** `SymPy` and `NumPy` (bundled as a custom AWS Lambda Layer)
- **Artificial Intelligence:** Google Gemini 3.5 Flash API (via Google AI Studio)

### Infrastructure Structure
- **Single-Lambda Design:** A unified AWS Lambda function (`MathApiFunction`) handles multiple routes via application-level routing.
- **Custom Lambda Layers:** Heavy mathematical dependencies (`sympy`, `numpy`) are separated into a Lambda Layer (`SymPyNumpyLayer`) to keep the deployment package lightweight and improve cold-start times.
- **Dynamic Configuration:** Environment variables (`GEMINI_API_KEY`, `ALLOWED_ORIGIN`) are injected at deploy-time to seamlessly toggle AI narration and configure strict CORS policies.

---

## 4. Architecture and Diagrams

The system architecture is broken down into four distinct visual perspectives to provide clarity across logical, user flow, low-level, and deployment domains. *(Please insert the provided architecture images alongside these descriptions).*

<img width="1024" height="559" alt="image" src="https://github.com/user-attachments/assets/0ca14a86-360c-4a46-9186-2d8f7c441c41" />


### Diagram 1: Core System Architecture (Logical View)
This diagram illustrates the primary request-response lifecycle within the AWS Cloud. Clients (browsers or mobile apps) issue calls to the Amazon API Gateway, which defines routes for `/solve`, `/riemann`, and `/integral-order`. The API Gateway triggers the unified `MathApiFunction` Lambda. The Lambda function leverages the attached `SymPyNumpyLayer` for core computations and conditionally reaches out to the external Google AI Studio (Gemini API) based on the presence of the `GEMINI_API_KEY` environment variable.

### Diagram 2: High-Level Design (HLD) - User Flow and Authentication
This view captures how different user personas interact with the broader ecosystem:
- **Guests (Unauthenticated):** Can browse the frontend hosted on AWS Amplify but may have restricted access to backend resources.
- **Authenticated Users & Hosts:** Authenticate globally via AWS Cognito User Pools to receive JWTs (JSON Web Tokens). 
- **API Access:** The frontend routes authenticated requests through the API Gateway, which can utilize a Cognito Authorizer to validate JWTs before forwarding the request to the Lambda function. Unauthenticated or invalid requests are rejected at the edge (e.g., 401 Unauthorized).

### Diagram 3: Detailed Low-Level Design (LLD) - Lambda Function Logic
This flowchart dives into the internal execution logic of the `MathApiFunction`.
1. **Input Reception:** The function receives the API Gateway payload and parses the request.
2. **Initialization:** Environment variables and math libraries (`sympy`, `numpy`) are loaded.
3. **Narration Branching:** The system evaluates the configuration. If the Gemini API key is present, it generates an AI-driven explanation. Otherwise, it falls back to a deterministic, rule-based text narration.
4. **Response Construction:** The mathematical results, narration, and strict CORS headers (`Access-Control-Allow-Origin`) are synthesized and returned as a JSON response.

### Diagram 4: Deployment & Infrastructure View
This diagram maps the developer deployment process and parameter boundaries. The developer initiates deployment via the `sam deploy --parameter-overrides` command. 
- **Parameters:** Secure environment values (`GeminiApiKey`) and configuration data (`AmplifyDomain`) are injected into the AWS environment.
- **Region:** The API Gateway, Lambda Function, and Layer are provisioned within a specific AWS Region.
- **Outputs:** Upon successful deployment, the stack outputs the `ApiUrl` (to be used as `VITE_API_BASE_URL` in the frontend) and the `FunctionName`.
