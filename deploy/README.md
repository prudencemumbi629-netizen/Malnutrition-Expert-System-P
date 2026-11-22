# Deploy Project FYM

The local launcher and Python API can be used before any cloud services are configured. Deploy to a preview environment first. Use separate Supabase projects and Cloudflare Worker names for preview and production.

## Configure Supabase

1. Disable public signups in the hosted project and invite each reviewer using Supabase Auth.
2. Apply the SQL in `supabase/migrations/` to the intended project. Grant invited users access by inserting their Auth user IDs into `public.demo_members` as a database administrator.
3. Deploy the `assess` Edge Function from the project root using the Supabase CLI and its checked-in configuration.
4. Set `APP_ALLOWED_ORIGINS` to the approved frontend origin or a comma-separated list of origins. Add the frontend URL to the Auth redirect allowlist if the configured sign-in flow requires a redirect.
5. Set `FYM_INFERENCE_ORIGIN` to the HTTPS origin of the inference Worker and store `FYM_INFERENCE_TOKEN` as an Edge Function secret. Use the same randomly generated token in the inference Worker secret.

## Deploy Cloudflare

1. Prepare the approved model artifact as described in the Python backend setup. The Docker build context is `Backend/`. Use a Workers Paid account with a Docker-compatible toolchain for Containers.
2. Deploy the inference Worker with Wrangler using `deploy/inference.wrangler.jsonc` and configure its `FYM_INFERENCE_TOKEN` secret. Check the deployed schema through the authenticated gateway and confirm the expected model version.
3. In the Supabase SQL editor, make the new release active in one transaction. Replace `<model-version>` with the exact `modelVersion` returned by the inference schema.

   ```sql
   begin;
   update public.assessment_releases set active = false where active;
   insert into public.assessment_releases (model_version, active)
   values ('<model-version>', true)
   on conflict (model_version) do update set active = true;
   commit;
   ```

4. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` before running the frontend build. Run `npm ci` and `npm run build` from `Frontend/`, then deploy using `deploy/frontend.wrangler.jsonc`. The static deployment contains only `Frontend/dist/`.
5. Verify the deployed frontend sign-in and access controls. Use cleaned KDHS inputs in the hosted environment only where covered by the project clearance. Verify that the active model version matches the deployed model and that responses use `Cache-Control: no-store`.

The published API accepts authenticated `GET` and `POST` requests at `/functions/v1/assess`. GET returns the input schema. POST returns the screening, clinical assessment, pharmacy guidance, and version sections. The first release provides model screening and shows pending states for clinical and pharmacy outputs until approved rules are available.
