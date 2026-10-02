# Netlify deployment

The current `ongpedro` project was published with Netlify Drop. Drop deployments do not automatically follow GitHub commits. Connect the project to this repository to deploy the site and its serverless functions together.

## Connect the repository

In Netlify, open `ongpedro` and choose **Project configuration > Build & deploy > Continuous deployment**. Link the GitHub repository `ksgs2901-cmd/ajudeopedro` and select the `main` branch.

The repository's `netlify.toml` sets the publish directory to the repository root and the functions directory to `netlify/functions`. No build command is required. After linking, trigger a deploy of the latest commit. Future pushes to `main` deploy automatically.

## Configure environment variables

In **Project configuration > Environment variables**, add these values for Production:

| Name | Required | Notes |
| --- | --- | --- |
| `BLACKCAT_API_KEY` | Yes | Private Blackcat API key used by the `X-API-Key` header. Never commit it or put it in frontend code. |
| `BLACKCAT_CUSTOMER_EMAIL` | Yes | Server-side customer email sent with each sale. |
| `BLACKCAT_CUSTOMER_PHONE` | Yes | Server-side customer phone sent with each sale. |
| `BLACKCAT_CUSTOMER_DOCUMENT` | Yes | CPF digits sent with each sale. |
| `BLACKCAT_CUSTOMER_NAME` | No | Defaults to `Contribuição Anônima`. |

The QR-only modal records each sale with the same configured customer identity. Add these variables before the production deploy, then redeploy so Netlify Functions receive them.