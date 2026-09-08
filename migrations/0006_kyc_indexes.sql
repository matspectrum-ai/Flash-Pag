-- Cover KYC audit/user foreign keys reported by the database advisor.
-- Merchant lookup indexes are already created by the initial KYC migration.

create index if not exists merchant_kyc_documents_uploaded_by_idx
  on public.merchant_kyc_documents(uploaded_by)
  where uploaded_by is not null;

create index if not exists merchant_kyc_events_actor_user_id_idx
  on public.merchant_kyc_events(actor_user_id)
  where actor_user_id is not null;

create index if not exists merchant_kyc_reviews_reviewer_user_id_idx
  on public.merchant_kyc_reviews(reviewer_user_id)
  where reviewer_user_id is not null;
