# Connect Now

Build a Random Live Video Call & Matching App

Create a modern mobile-first application inspired by the functionality of random live video-chat platforms. The application must have its own original branding, UI, colors, icons, and layout.

Recommended Tech Stack

Frontend: React Native + Expo

Backend: Supabase

Database: PostgreSQL through Supabase

Authentication: Supabase Auth

Realtime features: Supabase Realtime

Video/Audio Calls: LiveKit WebRTC

Push Notifications: Firebase Cloud Messaging / Expo Notifications

Storage: Supabase Storage

Admin Dashboard: Next.js

TypeScript throughout the project

1. Authentication

Create:

Sign up

Login

Logout

Forgot password

Email verification

Google login if supported

Account deletion

Secure session handling

New users must complete their profile before entering random matching.

2. User Profiles

Each profile should support:

Unique user ID

Display name

Username

Profile photo

Date of birth / age

Gender

Country

Short bio

Interests

Online/offline status

Last active

Account creation date

Account status

Never expose sensitive private user information to other users.

3. Home Screen

Create a polished mobile home screen containing:

User profile/avatar

Online status

Large "Start Matching" button

Recent calls

Messages

Notifications

Settings

Show the number of currently available users if the backend supports it.

4. Random Matching

Create a real-time matchmaking queue.

Flow:

User taps:

START MATCHING

↓

Set user status to "searching"

↓

Add user to matchmaking queue

↓

Find another available user

↓

Prevent matching the user with themselves

↓

Check block lists

↓

Atomically pair both users

↓

Generate a unique private call session

↓

Generate secure LiveKit room/token

↓

Connect both users

Matching states:

Idle

Searching

Match found

Connecting

Connected

Call ended

Reconnecting

Failed

Prevent duplicate matching and race conditions.

5. Live Video Call

Create a full-screen 1-to-1 video-call interface.

Include:

Remote user's video

Local camera preview

Display name

Connection status

Call duration

Microphone ON/OFF

Camera ON/OFF

Switch front/back camera

Speaker controls

End call

Report

Block

Next

The NEXT button should:

End the current session safely.

Remove the current match.

Clean up the video room.

Return the user to matchmaking.

Search for another available user.

Do not allow the same disconnected user to be immediately matched again.

6. Text Chat During Calls

Allow matched users to send text messages while connected.

Support:

Text messages

Emoji

Message timestamps

Do not expose phone numbers or email addresses.

7. Call History

Store safe call metadata such as:

Session ID

User A

User B

Started time

Ended time

Duration

Session status

Do NOT record or store private video/audio by default.

8. Report & Block System

Users must be able to report another account.

Report reasons:

Harassment

Sexual/inappropriate content

Nudity

Spam

Scam

Hate/abusive behavior

Underage user

Other

After blocking:

Immediately disconnect the call.

Prevent future matching.

Prevent direct communication where applicable.

Create a blocks database table and enforce blocks server-side, not only in the UI.

9. Moderation & Safety

Safety is a core requirement.

Implement:

Age eligibility checks

Community Guidelines

Terms of Service

Privacy Policy

Report system

Block system

User bans/suspensions

Rate limiting

Spam protection

Abuse detection

Secure authentication

Server-side authorization

Row Level Security

Never expose LiveKit API secrets or Supabase service-role keys inside the client application.

10. Admin Dashboard

Create a secure web-based admin dashboard.

Dashboard statistics:

Total users

Active users

Users online

Users currently searching

Active calls

Calls today

Reports

Suspended users

Banned users

Admin pages:

Users

Reports

Call Sessions

Moderation

Banned Accounts

System Settings

Admin actions:

View user

Review reports

Warn user

Suspend user

Ban user

Unban user

Terminate active session

All admin actions must generate audit logs.

11. Database

Create properly related PostgreSQL tables for:

profiles

matchmaking_queue

call_sessions

messages

blocks

reports

notifications

user_devices

moderation_actions

admin_audit_logs

Use UUID primary keys.

Include:

Foreign keys

Indexes

Created/updated timestamps

Constraints

Row Level Security policies

12. Presence System

Track:

ONLINE

OFFLINE

SEARCHING

IN CALL

AWAY

Automatically clean stale matchmaking entries when a user disconnects unexpectedly.

13. Security

Use server-side functions/endpoints for privileged operations.

Implement:

Input validation

Authentication checks

Authorization

RLS

Rate limiting

Secure token generation

Short-lived LiveKit access tokens

Environment variables

Error handling

Audit logging

Users must never be able to manually change another user's matchmaking status, reports, account status, or call records.

14. Connection Handling

Handle:

Slow internet

Camera permission denied

Microphone permission denied

User closes app

User loses internet

LiveKit disconnect

Match disconnects

Failed token

Empty matchmaking queue

Show friendly loading/reconnection states.

15. UI/UX

Design an original premium-looking interface.

Prioritize:

Mobile-first layout

Large video area

Simple controls

Smooth animations

Rounded cards/buttons

Dark/light mode

Safe-area support

Responsive layout

Clear loading states

Clear error messages

Do not copy Umingle's logo, branding, artwork, or exact interface.

16. Architecture

Organize the code into reusable components and services.

Separate:

UI

Authentication

Database

Matchmaking

Video calling

Messaging

Moderation

Notifications

Admin functions

Create clean TypeScript types for all database models.

Development Order

Build the project in phases:

Phase 1: Authentication + profiles

Phase 2: Database + RLS

Phase 3: Online presence

Phase 4: Matchmaking queue

Phase 5: LiveKit 1-to-1 video calling

Phase 6: Next/Skip functionality

Phase 7: Chat

Phase 8: Report + block

Phase 9: Admin dashboard

Phase 10: Notifications, testing and deployment

Start by generating the complete project architecture, database schema, environment-variable template, authentication flow, and matchmaking architecture.

Do not use mock functionality for core authentication, matchmaking, blocking, or authorization when implementing the production version.

Make the system scalable so coins, virtual gifts, premium subscriptions, filters, friend requests, and other monetization features can be added later without redesigning the core architecture.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/9426ebeb-0124-4b0f-be6c-749454e544c8).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
