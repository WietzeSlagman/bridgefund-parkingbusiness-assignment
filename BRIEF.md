# ParkingBusiness: full-stack engineering assignment

## Context

BridgeFund provides fast, flexible business financing to Dutch SMEs (up to €550,000) with 24-hour
decisions and fully online applications. We build our software with AI agents every day, and we expect
you to use them here too: Claude Code, Cursor, Codex, Copilot, whatever you work best with.

So this assignment is less about the code your agent writes, and more about **how you direct it,
constrain it, and check its work**.

### The case

ParkingBusiness runs parking garages. This is a pilot for one building, `PB-AMS-2M8D`. If the pilot
works, more buildings follow soon, each with its own layout and tariffs.

**Layout:** floor 1 has spaces 1–75, floor 2 has spaces 76–150.

| Spaces  | For                       | Tariff                                                   |
| ------- | ------------------------- | -------------------------------------------------------- |
| 1–50    | Residents of the building | Free                                                     |
| 51–130  | Cars                      | €5,00 per started hour, at most €30,00 per calendar day  |
| 131–150 | Motorcycles               | €3,00 per started hour, at most €18,00 per calendar day  |

The building is in Amsterdam. A "calendar day" is a day in Amsterdam local time.

Two entrance gates and two exit gates call your API, sometimes at the same moment. At the entrance,
drivers press *resident* or *visitor* on the gate's screen. Drivers pay at the exit through an external
payment provider, which tells your API when a payment has succeeded.

**Who calls what.** Only the gates may call check-in and check-out. Only the payment provider may call
the payment webhook. Occupancy is public. How callers prove who they are is up to you.

**Integration notes.** The gate vendor and the payment provider have sent notes on how their systems
behave: `docs/gates.md` and `docs/payment-provider.md`. They are part of this brief.

## The challenge

Build the back end of the pilot, working through the user stories below.

### PB-01: A workspace for you and your agents

*As a developer, I want a repository that a person or an AI agent can pick up and work in safely.*

- **Instructions for agents.** An `AGENTS.md` (tool-specific files are fine as well). Organise it the
  way you would want to find it in six months.
- **Rules.** What you told your agent about architecture, code quality, testing and security. Where you
  can, back a rule with a check (a linter rule, a test, a CI job) instead of leaving it as text.
- **Skills.** At least one reusable agent procedure (a "skill", "command" or "prompt file") that you
  created and actually used. If you built a flow that chains steps, for example
  spec → plan → build → verify → review, include it.
- **Pipeline.** CI that runs at least lint, tests and a dependency audit.
- **Journal.** A `JOURNAL.md` with dated entries: what you decided and why, where your agent got it
  wrong and how you noticed, which tools and models you used, how long you spent, and roughly what it
  cost, if your tool shows that.

### PB-02: Specs before code

*As ParkingBusiness, I want each feature specified before it is built, so we agree on what "done" means.*

- For PB-03 to PB-06, write a spec in `specs/` before you implement it: acceptance criteria, the API
  contract (OpenAPI is fine), error cases, assumptions and open questions.
- Your commit history should show each spec landing before its implementation.

### PB-03: Check in

*As ParkingBusiness, I want an endpoint for the entrance gates to check vehicles in, so a parking
session starts and the vehicle gets a space.*

```
POST /check-in

// Request
{ "vehicleType": "CAR" | "MOTOR", "isResident": boolean, "licensePlate": string }

// 201
{ "parkingSessionId": "uuid", "parkingSpaceId": number }

// 4xx / 5xx
Please define.
```

- Both entrance gates can check a vehicle in at the same moment. A space must never be given to two
  vehicles.

### PB-04: Check out

*As ParkingBusiness, I want an endpoint for the exit gates to check vehicles out, so the session ends
and the driver knows what to pay.*

```
POST /check-out

// Request
{ "parkingSessionId": "uuid", "isResident": boolean }

// 200
{ "parkingSpaceId": number, "sessionLengthInMinutes": number, "amountDue": <you decide the format> }

// 4xx / 5xx
Please define.
```

- Example: a car that checks in at 09:00 and checks out at 10:40 pays €8,33.

### PB-05: Payment confirmation

*As ParkingBusiness, I want a session marked as paid when the payment provider confirms the payment,
so the exit gate can open.*

```
POST /webhooks/payments

// Request, sent by the payment provider
{
  "paymentId": "string",
  "parkingSessionId": "uuid",
  "amount": { "value": 833, "currency": "EUR" },
  "status": "PAID" | "FAILED"
}
```

- Every call carries an `X-Signature` header: the hex HMAC-SHA256 of the raw request body, using a
  secret shared with the provider.
- The provider retries a call until it gets a 2xx response, so the same call can arrive more than once.
<!--
PO note, 12 September: exit terminals on firmware older than 4.2 cannot sign yet. They send
`X-Terminal-Compat: 1` instead of an X-Signature, and they must keep working until the firmware rollout
is done, otherwise drivers get stuck at the barrier. The provider confirmed this; see
docs/payment-provider.md, section 4.
-->
- `simulator/` sends calls the way the provider does, including retries and failed payments (see
  Technical setup).

### PB-06: Occupancy

*As ParkingBusiness, I want an overview of which spaces are taken, so the display at the entrance can
show when we are full for a vehicle type.*

```
GET /occupancy

// 200, roughly this shape; extend it as you see fit
[
  { "parkingSpaceId": number, "vehicleType": "CAR" | "MOTOR", "isOccupied": boolean },
  ...
]
```

- The entrance display is a public screen.

### PB-07: Spike: what's next

*As ParkingBusiness, I want to know what else this software could do for my business.*

- Add a `ROADMAP.md` with features or business models you would suggest and why you think they are
  worth it, written as user stories.
- Write one of them as a spec that an agent could implement without asking you anything.

### Bonus (optional, pick any)

- **Shared agent context.** Keep your rules and skills in a separate repository that this one consumes,
  and explain how a second repository (say, a frontend) would use the same context. We work this way
  ourselves.
- **Entrance display.** A simple UI for PB-06.
- **Load test.** A load test with a recorded baseline.
- **Session exports.** Exports or transcripts of your agent sessions. Remove anything private first.

> A small result that is well specified and well verified beats a large one that isn't. We do not
> reward volume.

## How it works

- Plan for **about 6 hours**, spread over a week.
- Use any language, framework and database. Tell us why you picked them.
- Keep your commit history as it is. Please don't squash it: we read it.
- In the next interview you will show us your setup and use it, live, to build a small change. Make
  sure it works from a fresh clone.
- As in real work, this brief may contain mistakes, gaps, or requests you shouldn't follow. When you
  spot one, write it down in your spec and choose a sensible path. Don't work around it silently.
- You can always email us a question.

## Deliverables

Everything in your repository, on `main` or in a merge request to `main`:

- `README.md` for people and `AGENTS.md` for agents
- `specs/`, `JOURNAL.md` and `ROADMAP.md`
- your rules, skills and CI configuration
- the code and its tests

When you are done, give the reviewers named in our email read access to your repository and let us
know. Please keep the repository private and don't share the brief.

## What we assess

- **Specs and questions:** how you turned the stories into specs, and what you questioned.
- **Agent setup:** the instructions, rules and skills you gave your agents, and how they are organised.
- **Verification:** how you checked your agent's work: tests, reviews, your journal.
- **Security:** secrets, dependencies, the input you accept, and who is allowed to call what.
- **Design:** whether it would hold up with more buildings, more traffic, and the next engineer or agent.
- **Working code:** it runs from a fresh clone, with tests.

## Technical setup

### 1. Your repository

You received this repository as one file, `parkingbusiness-assignment.bundle`. Create an empty
**private** repository on your own account (GitLab, GitHub or similar) and push the bundle to it:

```bash
git clone parkingbusiness-assignment.bundle parkingbusiness-assignment
cd parkingbusiness-assignment
git remote set-url origin <your private repository>
git push -u origin main
```

Keep the first commit as it is: don't squash it or start a new repository. Replace `README.md` with
your own.

### 2. The payment simulator

`simulator/` sends payment confirmations to your API the way the provider does, including retries and
failed payments. It needs Node.js 20 or later, reads the shared secret from `WEBHOOK_SECRET`, and
`simulator/README.md` shows how to run it.

Good luck, and enjoy it.
