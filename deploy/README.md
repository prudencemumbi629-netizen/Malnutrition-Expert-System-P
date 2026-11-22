# Deploy Project FYM

The local launcher and Python API can be used before any cloud services are configured. Deploy to a preview environment first. Use separate Supabase projects and Cloudflare Worker names for preview and production.

## Configure Supabase

1. Disable public signups in the hosted project and invite each reviewer using Supabase Auth.
2. Apply the SQL in `supabase/migrations/` to the intended project. Grant invited users access by inserting their Auth user IDs into `public.demo_members` as a database administrator.
3. Deploy the `assess` Edge Function from the project root using the Supabase CLI and its checked-in configuration.
4. Set `APP_ALLOWED_ORIGINS` to the approved frontend origin or a comma-separated list of origins. Add the frontend URL to the Auth redirect allowlist if the configured sign-in flow requires a redirect.
5. Set `FYM_INFERENCE_ORIGIN` to the HTTPS origin of the inference Worker and store `FYM_INFERENCE_TOKEN` as an Edge Function secret. Use the same randomly generated token in the inference Worker secret.

### Assign clinical rule validation access

After applying the clinical rule validation migration, a database administrator can enable the action for a designated reviewer who already belongs to the research workspace. Use that reviewer’s Supabase Auth user ID.

```sql
update public.demo_members
set can_validate_clinical_rules = true
where user_id = '<reviewer-auth-user-id>';
```

The reviewer can then sign in and select **Validate rule** on the clinical decision table. Supabase records the first validation for each rule version, including the reviewer and timestamp. Workspace members can see the status and date. Bump the table’s ruleset version when its criteria, decisions, or sources change so revised rules receive a fresh review.

### Publish the model evaluation

Apply the model evaluations migration to create the report table. In the approved research environment, run `python Backend/export_evaluation.py` against the artifact used by the active release. The command prints model settings and aggregate results for the held-out test set.

When the aggregate report is approved for the hosted workspace, insert the exported JSON through the Supabase SQL editor as a database administrator. Replace the placeholder inside the dollar quotes with the full JSON output.

```sql
with evaluation(report) as (
    values ($evaluation$PASTE_EXPORTED_JSON_HERE$evaluation$::jsonb)
)
insert into public.model_evaluations (model_version, report)
select report ->> 'model_version', report from evaluation
on conflict (model_version) do update set report = excluded.report;
```

Workspace members can read the report for the active release from **Model evaluation**. Keep the source dataset, holdout rows, and full report in the approved research environment.

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

## Use Render Free for inference

1. Create a Render **Free Web Service** using Docker, `Backend/` as the root directory, and `Dockerfile.render` as the Dockerfile. Upload the approved model to private storage. In Render, create a secret file named `fym_model_url` containing its signed HTTPS download URL and set `FYM_MODEL_SHA256` to the artifact's lowercase SHA-256 digest. The build verifies the download against that digest before it packages the model. Refresh the URL before an uncached rebuild if it has expired. Keep the training data and evaluation report out of the image.
2. Set `FYM_INFERENCE_TOKEN` in Render and Supabase Edge Function secrets to the same randomly generated secret. Set Render's health check path to `/health`. The schema and assessment routes require the token.
3. Set `FYM_INFERENCE_ORIGIN` in Supabase to the Render HTTPS origin. Configure `APP_ALLOWED_ORIGINS`, reviewer access, and the active model release using the same Supabase steps above.
4. Deploy the updated `assess` function and frontend. In the signed-in dashboard, use **Wake Render** to start the service and load the screening schema. The dashboard reports the result of the last check and sends a request only when asked.
