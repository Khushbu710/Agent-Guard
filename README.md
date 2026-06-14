# AgentGuard

**Autonomous AI Agents with On-Chain Credentials and Treasury Governance**

AgentGuard is a decentralized framework that allows AI agents to earn on-chain credentials through completed work, build reputation over time, and autonomously create treasury spend requests based on their analysis. Human governance remains in control through approval, rejection, and execution of treasury actions.

Built on **Arbitrum Sepolia**, AgentGuard combines AI decision-making, verifiable on-chain credentials, and treasury governance into a single system.


---

## Deployment

### Frontend

```text
[ADD FRONTEND URL]
```

### Backend

```text
[ADD BACKEND URL]
```

### Smart Contract

```text
0x954f2FBC0fA38E3fa940E551EF5396C132cE1286
```

---

## Demo

### Demo Video

```text
[ADD VIDEO LINK]
```
---

## Overview

Traditional AI agents can generate recommendations, but they have no verifiable reputation and no structured path to participate in treasury decisions.

AgentGuard introduces:

- **On-chain credentials** earned through completed tasks
- **Reputation-based agent progression**
- **Credential-gated treasury permissions**
- **Autonomous treasury request generation**
- **Human-in-the-loop governance controls**
- **Verifiable on-chain history for every agent**

An agent's authority is determined by its demonstrated performance rather than arbitrary trust assumptions.

---

## Key Features

### On-Chain Credentials

Every completed task generates:

- Task type
- Evaluation score
- Evidence hash
- Timestamp

Credentials are permanently recorded on-chain.

---

### Reputation & Credential Levels

Agents build reputation through performance.

Current credential tiers:

| Level | Requirements | Spend Limit |
|---------|---------|---------|
| Unverified | Default | 0 ETH |
| Bronze | Performance threshold reached | 0.1 ETH |
| Silver | Higher reputation threshold | Higher treasury authority |
| Gold | Highest reputation tier | Maximum treasury authority |

Credential levels are derived automatically by the smart contract.

---

### Autonomous Treasury Requests

After completing a task:

1. Agent performs analysis
2. Output is evaluated
3. Credential is recorded on-chain
4. Agent determines whether treasury action is required
5. Deterministic treasury policy computes allowable amount
6. Spend request is submitted on-chain

The AI decides **whether funding is required**.

The amount is determined by deterministic policy rules, not by the AI.

---

### Human Governance

Agents cannot spend funds directly.

All treasury actions remain subject to governance approval.

Supported actions:

- Approve Request
- Reject Request
- Cancel Request
- Execute Request

This creates a balance between autonomous intelligence and human oversight.

---

### Deterministic Treasury Policy

The AI never decides the amount of money requested.

Instead:

- Evaluation score determines confidence
- Credential level determines maximum authority
- Treasury availability limits request size

This ensures predictable and auditable treasury behavior.

---

## Architecture

```text
                    ┌────────────────────┐
                    │   User Creates     │
                    │       Task         │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │      AI Agent      │
                    │ Executes Analysis  │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │ Evaluation Engine  │
                    │ Scores Output      │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │ On-Chain Credential│
                    │ Recording          │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │ Treasury Decision  │
                    │ Service            │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │ Spend Request      │
                    │ Created On-Chain   │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │ Human Governance   │
                    │ Approval / Reject  │
                    └────────────────────┘
```

---

## Tech Stack

### Frontend

- React
- TypeScript
- Vite

### Backend

- Node.js
- Express
- TypeScript

### Blockchain

- Solidity
- Hardhat
- Arbitrum Sepolia

### AI

- Groq API
- Qwen 3 32B

---

## Smart Contract Capabilities

### Agent Registry

- Register agents
- Track reputation
- Track credential levels
- Track treasury authority

### Credential System

- Record task credentials
- Store evidence hashes
- Automatic level progression

### Treasury Governance

- Treasury deposits
- Spend requests
- Approval workflow
- Rejection workflow
- Execution workflow

---

## Autonomous Treasury Flow

```text
Task Created
      │
      ▼
Agent Executes Task
      │
      ▼
Output Evaluated
      │
      ▼
Credential Recorded On-Chain
      │
      ▼
Agent Determines Funding Need
      │
      ▼
Deterministic Policy Computes Amount
      │
      ▼
Spend Request Created On-Chain
      │
      ▼
Governance Review
      │
      ▼
Approve / Reject / Execute
```

---

## Example Agent Lifecycle

```text
Agent Registered
      │
      ▼
Completes Tasks
      │
      ▼
Earns Credentials
      │
      ▼
Builds Reputation
      │
      ▼
Reaches Bronze Level
      │
      ▼
Eligible For Treasury Requests
      │
      ▼
Creates Autonomous Spend Requests
      │
      ▼
Governance Review
```

---

## Repository Structure

```text
AgentGuard
│
├── frontend/
│   ├── src/
│   └── public/
│
├── backend/
│   ├── src/
│   ├── routes/
│   ├── services/
│   └── models/
│
├── contracts/
│   ├── AgentGuard.sol
│   └── scripts/
│
└── README.md
```

---

## Future Improvements

- Multi-agent treasury councils
- Agent voting mechanisms
- ZK-based credential verification
- Cross-chain credential portability
- Agent-to-agent coordination
- Autonomous budget allocation
- Wallet-based governance approvals
- DAO integrations

---

## Why AgentGuard?

AI systems are becoming increasingly capable of making decisions, but they lack verifiable reputation and accountable governance structures.

AgentGuard bridges this gap by enabling agents to:

- Earn verifiable on-chain credentials
- Build reputation through demonstrated performance
- Participate in treasury workflows
- Operate under transparent governance constraints

The result is a framework where autonomous agents can contribute meaningfully to decentralized organizations without sacrificing accountability or human oversight.

---

## License

MIT
