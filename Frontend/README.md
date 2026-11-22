# Project FYM frontend

React and Vite provide the screening workspace. Start the [Python API](../Backend/README.md), then run `.\dev.cmd` from the project root. The Vite development server forwards `/api` requests to `127.0.0.1:8000`.

For a hosted build, set both values in [the environment template](.env.example). The app then uses invite-only Supabase sign-in and calls the Supabase assessment function. Follow the [deployment guide](../deploy/README.md) to configure the approved origins and reviewer access.

Use `npm run lint` and `npm run build` from this directory to verify frontend changes.
