# Free deployment checklist

## Supabase

1. Create a free Supabase project.
2. Click **Connect**.
3. Copy the **Transaction Pooler** connection URI (port 6543).
4. Keep the database password private.

The Express backend creates the schema automatically on first boot.

## Render API

1. Create a free Web Service from this repository.
2. Root directory: `server`.
3. Build: `npm install`.
4. Start: `npm start`.
5. Add `DATABASE_URL`, `JWT_SECRET`, `APP_TIMEZONE=Europe/Vilnius`.
6. Temporarily set `CLIENT_ORIGIN=http://localhost:5173`, then change it to the Vercel URL after frontend deployment.
7. Test `https://YOUR-API.onrender.com/api/health`.

## Vercel frontend (preview/testing on Hobby)

1. Import the repository into Vercel.
2. Root Directory: `client`.
3. Framework: Vite.
4. Build Command: `npm run build`.
5. Output Directory: `dist`.
6. Environment variable: `VITE_API_BASE_URL=https://YOUR-API.onrender.com`.
7. Deploy.
8. Return to Render and set `CLIENT_ORIGIN` to the final Vercel URL.
9. Redeploy/restart the Render API.

## Test logins

- owner / Owner123!
- samuel / Worker123!
- clemence / Worker123!

Change passwords before real use.
