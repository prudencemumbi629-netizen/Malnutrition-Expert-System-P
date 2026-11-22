# Project FYM frontend

React and Vite provide the screening workspace. Start the [Python API](../Backend/README.md), then run `npm run dev` from the project root. The Vite development server forwards `/api` requests to `127.0.0.1:8000`. On Windows, `.\dev.cmd` also works with the project-local Node.js installation.

For a hosted build, set both values in [the environment template](.env.example). The app then uses invite-only Supabase sign-in and calls the Supabase assessment function. Follow the [deployment guide](../deploy/README.md) to configure the approved origins and reviewer access.

Use `npm run lint` and `npm run build` from this directory to verify frontend changes.

## Batch screening

Open **Batch screening**, check the service, and download the CSV template. Each record needs a unique, non-identifying `record_id`, the child's age in months (`b19`), and sex (`b4`). Other model predictors are optional. Clinical columns use `muac_mm`, `whz`, `oedema`, and `danger_signs`. Use `none` to record that no danger signs were reported. Leave unrecorded findings blank.

A batch can contain up to 25,000 records and 10 MB. The open tab keeps the file, progress, and results in memory while the service screens chunks of up to 40 rows. Switch workspace pages without interrupting a batch. Download results before closing or refreshing the tab. Row IDs and optional `nutrition_status` labels stay in the browser. Known labels add an evaluation summary for the successfully screened, labeled records.

Hosted batch screening requires the batch-capable inference service, the updated Supabase `assess` Edge Function, and the frontend. When using Cloudflare Containers for inference, deploy its updated gateway Worker as well. No database migration is required.
