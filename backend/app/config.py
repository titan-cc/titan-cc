from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    database_url: str = "postgresql+asyncpg://titan:titan@localhost:5432/titan"

    # Clerk
    clerk_secret_key: str = ""
    clerk_publishable_key: str = ""
    clerk_jwks_url: str = ""

    # AWS / S3
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "ap-south-1"
    s3_bucket: str = "titan-transcribe-prod"

    # RunPod
    runpod_api_key: str = ""
    runpod_endpoint_id: str = ""
    runpod_endpoint_url: str = ""
    runpod_webhook_secret: str = "dev-secret"

    # Railway (billing)
    railway_api_token: str = ""
    railway_project_id: str = ""

    # Resend
    resend_api_key: str = ""
    resend_from_email: str = "noreply@tools.soexcellence.com"

    # Sentry
    sentry_dsn: str = ""

    # App
    app_env: str = "development"
    api_base_url: str = "http://localhost:8000"
    cors_origins: list[str] = ["http://localhost:5173", "https://tools.soexcellence.com"]
    # Comma-separated emails that get role='admin' on first sign-in
    admin_emails: list[str] = []


settings = Settings()
