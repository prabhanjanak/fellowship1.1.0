# Tasks - Speciality and Preferred Location Table Column & Excel Export Enhancements

- [x] Update frontend Submissions table column **"Applied For"** in `ApplicationFormsPage.tsx`
  - [x] Define normalization color helper `getSpecColorClass` next to `SPEC_BADGE_COLORS`
  - [x] Rewrite "Applied For" column rendering in `ApplicationFormsPage.tsx` to display all active center preferences (excluding `"Not Applicable"`) formatted as `${spec}: ${loc}`
- [x] Update backend Application Forms Excel Export in `application-forms.ts`
  - [x] Add unified `getCenterPrefs` parser inside `GET /application-forms/:id/export`
 ## Phase 6: Mark Sheet View & Excel Score Exports
- [x] Implement `GET /interviews/my-scores/export` for doctor evaluations inside `interviews.ts`
- [x] Implement `GET /interviews/scores/export` for coordinator master score report inside `interviews.ts`
- [x] Remove individual doctor assignments tab from Admin view in `InterviewsPage.tsx`
- [x] Implement "Is Mind Matter" checkbox in panel creation and editing dialogs in `InterviewsPage.tsx`
- [x] Create the new premium "Mark Sheet" tab inside Admin view in `InterviewsPage.tsx` with Specialized dropdown, unified 110-marks breakdown, and export button
- [x] Add "Download My Evaluations" export button inside Doctor assignments view in `InterviewsPage.tsx`

## Phase 7: Verification and Build Validation
- [x] Verify frontend compiles successfully
- [x] Verify backend compiles successfully
- [x] Run full workspace build check `pnpm run build`

## Phase 8: Clinical Evaluation Modal Iframe Fix
- [x] Rebuild backend API server bundle using `pnpm --filter @workspace/api-server run build`
- [x] Terminate stale backend server instance and launch updated build on port 3002
- [x] Verify `/api/submission-view/:id` matches successfully (returns `401 Unauthorized: Missing token` instead of `404 Not Found`)

