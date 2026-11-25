# Garage Inspection

Implementation plan for the local Parts Arc Capstone project. The first release lets a customer find a garage, a garage owner assign an inspection, and a mechanic submit findings with evidence. The owner can then share selected findings and files with that customer.

## Local design preview

| Screen | Route |
| --- | --- |
| Customer Garage Finder | [localhost:3000/garages](http://localhost:3000/garages) |
| Garage Owner Dashboard | [localhost:3003/owner](http://localhost:3003/owner) |
| Mechanic Workspace | [localhost:3003/mechanic](http://localhost:3003/mechanic) |

Run `npm ci` and `npm run dev -- -H localhost` in `C_frontend` and `G_db` in separate terminals. The finder uses sample listings. The owner and mechanic preview share browser-local jobs, profiles, ledger entries, quotations and report metadata. Credential reset produces a demo code. The customer search is the customer preview for this phase. Use sample details for the prototype.

## Decisions for the first release

| Area | Proposed approach |
| --- | --- |
| Backend | Add garage and inspection modules to the existing Express API and PostgreSQL schema. Reuse the existing identity, session, API response and validation patterns. |
| Frontends | Keep public search and shared reports in `C_frontend`. Add **Garages** to the existing `A_db`. Create `G_db` as its own Next.js app for the owner and mechanic, with a proposed local URL of `http://localhost:3003`. |
| Provisioning | Admin creates the garage and its owner account, sets the access period and records a manually confirmed payment amount. The owner creates mechanic accounts and completes the public profile in `G_db`. |
| Garage discovery | Search one location area, one service and an optional garage type. Start with a small shared list of areas, types and services used by both the profile editor and search form. |
| Vehicle intake | Start with walk-in intake. The customer finds the garage and calls or visits. The owner creates the inspection job when the car arrives. |
| Evidence | Use photos first, then one short manually uploaded video clip per inspection. The mechanic records on an action camera, transfers or exports the clip, and chooses the file. Findings come from the mechanic and are reviewed by the owner. |
| Garage fee | Store the amount received from the garage in BDT for the access period as an admin record. |
| Garage finance | Give the owner a simple ledger of received revenue and internal expenses. Calculate sales entry count and net profit or loss from that ledger. Quoted labour only becomes recorded revenue when the owner logs a received payment. |

## Customer experience

### Where customers find it

- **Desktop header and mobile menu** — Add **Find a Garage** after **Find Parts**. Rename the existing **Garages & Fleets** link to **Garage & Fleet Sourcing** so it still leads to the current parts procurement section.
- **Mobile bottom bar** — Add **Garages** between **Find Parts** and **My Requests** or **Track Request**. Keep Home and the existing request action accessible, use short labels with icons, and check all four items at 320 px.
- **Homepage** — Add a secondary **Find a Garage** link just below the existing hero actions. All entry points go to `/garages`.
- **Customer dashboard** — Add **Garage Reports** when sharing ships. It lists explicitly shared reports for the signed-in customer. Selecting a report opens its findings and chosen evidence.

### Search form and results

Use a dedicated page with the existing storefront typography, colors and form components. On desktop, show three labelled fields and **Search Garages** in a row, with results below. On a phone, stack fields above one full-width button and show one result card per row.

| Field | Control | Requirement |
| --- | --- | --- |
| Area | Select with a town or area label, such as Mirpur or Dhanmondi | Required |
| Service | Select, such as diagnostics, brakes, electrical or AC | Defaults to **Any service** |
| Garage type | Select, such as general workshop, specialist or body shop | Defaults to **Any type** |

```text
Find a Garage
Area                 [ Mirpur             ▾ ]
Service              [ Brakes             ▾ ]
Garage type          [ Any type           ▾ ]
[               Search Garages               ]

Mirpur Auto Workshop
Mirpur · General workshop
Brakes, diagnostics
[ View garage ]                     [ Call ]
```

- Keep filters in URL query parameters so Back, reload and shared links preserve the search. Validate filter keys on the server and return a bounded result page in stable order.
- Each card shows garage name, area, type, a short service list and the published phone number via **Call**. **View garage** opens `/garages/[slug]` with the full street address, services, phone, and optional opening hours.
- Provide loading, request failure, and no-result states. Keep inputs intact on failure. Offer **Clear service and type** from the empty state while keeping the selected area.
- Guests can search and view complete profiles for garages with active access. A customer account is needed to receive and view a report. Avoid collecting registration number, customer name, exact location or contact details in the search form.
- Use persistent visible field labels, keyboard focus, clear error text, and accessible result updates. Aim for at least 44 px tap height for primary mobile controls. [W3C form labels](https://www.w3.org/WAI/tutorials/forms/labels/) · [W3C target size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

## Admin garage management

Add one **Garages** menu item in `A_db` at `/garages`, available to authorized admin and logistics operators through the existing admin permission model. Use one screen with **Create Garage** at the top and a list below. On phones, render each row as a card with the same actions.

| Create Garage field | Requirement |
| --- | --- |
| Garage name | Required |
| Owner name, phone and contact email | Required. These are admin contact details. The owner supplies the public phone separately. |
| Owner username | Required. Trim and compare case-insensitively within the garage portal. |
| Temporary password | Generate on the server and show once to admin for private handoff. Require a password change on first sign-in. |
| Access duration in months | Required positive whole number. Start access at creation and display the calculated expiry. |
| Amount received in BDT | Optional manual amount. Allow zero for complimentary access and leave blank when no amount has been recorded. |

- Show garage name, owner username, access end date, amount received, and status. Use **Active**, **Expired**, and **Terminated**. Display an incomplete profile separately so admin can distinguish access from directory visibility.
- **Terminate access** asks for confirmation, blocks both garage roles immediately and removes the garage from customer search and its public detail route. Preserve jobs, reports, and records. Check expiry on requests so the cut-off works even when the worker is stopped.
- **Reset owner credentials** creates a new temporary password, invalidates the owner's existing sessions, and requires a password change at the next sign-in. Reset leaves the current access period and termination status as recorded.
- Use the supplier onboarding flow as a reference for temporary passwords, required password changes and session revocation. Store password hashes and audit access changes without recording plaintext secrets. [Existing supplier onboarding](../backend/src/modules/suppliers/supplier.service.ts)

## Garage portal sign-in

Build one sign-in screen in `G_db` with **Garage Owner** and **Mechanic** choices, then username and password. The API verifies the credentials, garage access and active membership, and confirms that the selected role matches the account. Open each role’s **Dashboard** after sign-in. Protect each workspace route and API action based on the confirmed membership. Garage sessions use a dedicated `garage` cookie namespace so they can coexist with the customer, supplier and admin sessions.

Owners can request password recovery from the sign-in page using their username and registered email. Admin reviews **Owner password requests** in **Garages**, issues a temporary password, and emails it to the registered address. Issuing the password closes the request and revokes existing sessions. The owner changes the temporary password at next sign-in. Mechanics request a reset from their garage owner.

## Garage owner workspace

Use five menu items. Keep account actions under the avatar. Start on **Dashboard** with finance totals and jobs needing assignment or report review.

| Menu | Minimum content |
| --- | --- |
| **Dashboard** | Recorded revenue, expenses, net profit or loss, sales entry count and urgent jobs. |
| **Jobs** | **New Job** button, filters for **Needs assignment**, **Assigned**, **Ready for review** and **Closed**. Each row or card shows job reference, vehicle, mechanic and status. The detail screen contains intake data, assignment, and **Report**, **Quotation** and **Evidence** sections. |
| **Mechanics** | Name, username, active status, and **Add Mechanic**. The owner enters the mechanic's name, username and contact email. Support editing mechanic details and resetting forgotten credentials. Show the generated temporary password once for private handoff. The mechanic changes it on first sign-in. The owner can deactivate the membership while past jobs retain their attribution. |
| **Finance** | Add, edit or remove a received payment or expense with a date, description and amount. |
| **Garage Profile** | Public name, garage type, area, street address, public phone, offered services, optional hours and short description. Use **Save Profile**. A complete profile for an active garage appears in customer search automatically as soon as it is saved. |

Use the garage name set by admin as the initial public name. Require an area, address, valid public phone, garage type and at least one service before showing the profile. The API applies this same eligibility rule to search and direct links. Profile edits become visible on save without an admin approval step.

- **New Job** collects the existing customer account email, a short vehicle label, requested service and an optional complaint. Allow an optional saved-vehicle reference only when it belongs to that customer. Confirm the linked customer before saving. Support one garage per owner account.
- **Assign mechanic** lists active mechanics from this garage only. The owner can reassign before a draft exists. For the first release, the API locks assignment once a draft exists and the UI explains why.
- **Report** shows the mechanic’s findings and lets the owner return them for edits. **Quotation** lists required parts and availability alongside a BDT labour total. Leave part prices out of the quotation. **Evidence** records a customer request and lets the owner choose specific photos or clips. The owner shares the report or quotation to the linked customer account. The customer can request evidence, and the owner selects which files to share.
- On desktop, use a side navigation and a job table. On mobile, keep the five main actions in a floating bottom bar, with a compact brand-and-account header. Use job cards in place of wide tables and shadcn-style Select controls for menu options.

On a phone, the owner's default screen can start with this layout.

```text
Garage Workspace                  [ Account ]
[ Home ] [ Jobs ] [ Mechanics ] [ Finance ] [ Profile ]

Jobs                              [ New Job ]
[ Needs assignment ▾ ]
JOB-104 · Toyota Axio
Brake inspection                    Unassigned
[ Open Job ]
```

## Mechanic workspace

Give the mechanic **Dashboard**, **My Jobs** and **Profile**. The mobile workspace uses those three buttons in a floating bottom bar. Dashboard shows active, awaiting review and completed job counts, plus the next jobs. My Jobs shows assigned work and the report editor. Profile stores the mechanic’s photo, name, email, phone and specialty.

```text
My Jobs                        [ Account ]
JOB-104 · Toyota Axio
Brake inspection                [ Open ]

JOB-104 · Toyota Axio
Customer concern
[ Inspection summary                     ]
[ Add finding ]  [ Add photo ]  [ Add clip ]
[ Save Draft ]            [ Submit Report ]
```

- Job details show the customer's concern, without requiring the mechanic to see the customer's email or phone.
- Require an inspection summary. Each optional finding records the component, observed issue, and recommended next step. Let the mechanic attach a photo to the report or to a specific finding when that context matters.
- Show photo previews and video filename, size, upload progress and a retry action. Keep the draft when an upload fails. Keep **Save Draft** and **Submit Report** easy to reach on a narrow phone, with enough bottom space for errors and safe insets.
- Use the native file picker for both evidence types. A separate **Take Photo** option can request the rear camera when the browser offers it. Preserve **Choose File** for imported action-camera footage. [MDN file input](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file)

## Backend and data boundaries

Keep one Express API and one PostgreSQL database. Run `G_db` alongside the other frontends, add its local origin to CORS, and follow the established auth client, cookie and CSRF patterns. Use a dedicated garage identity type with the existing User, password and session infrastructure. Store Owner and Mechanic as garage membership roles and restrict garage credentials to the garage sign-in flow. The portal resolves usernames in its own namespace before authenticating the associated account. [Auth client](../backend/src/modules/auth/auth-client.ts) · [API router](../backend/src/routes/index.ts) · [Prisma schema](../backend/prisma/schema.prisma)

| Record | Owns |
| --- | --- |
| `Garage` | Owner contact, public profile, normalized area, garage type, service keys, access start and expiry, amount received, termination timestamp |
| `GarageMembership` | Unique garage/user pair, unique normalized portal username, owner or mechanic role, and active state |
| `GarageJob` | Garage, verified customer link to an existing account, intake vehicle and concern, evidence consent and its timestamp, assigned mechanic and state |
| `InspectionReport` | Job, active author, draft or submitted status, summary and findings |
| `InspectionEvidence` | Report, optional finding reference, file type, generated storage key, byte count and uploader |
| `InspectionShare` | Job, owner, recipient account, customer-facing summary or selected findings, selected file IDs, share and revocation timestamps |

Provision the garage, owner identity and membership in one admin operation. Create mechanic identities and memberships from `G_db` under the authenticated owner's garage. Keep one shared list of area, service and garage-type codes for the profile editor and the public search form. Persist reports in PostgreSQL and keep files in the ignored local storage directory.

Use additive migrations. Return only directory fields in public search and details. Check the garage access period, termination state, active membership and job assignment as applicable on every workspace operation, including requests from existing sessions. On customer report and evidence reads, verify that the share is active and belongs to the signed-in customer. Preserve customer access to explicitly shared evidence after garage expiry or termination. A mechanic submit locks the draft. An owner can return it for edits before publication. After sharing, keep the inspection findings fixed. The owner can send an updated quotation and manage requested evidence. Store the share and its selected items in one transaction.

Group routes around admin garage management, public garage search and detail, authenticated garage workspace operations, and the customer's shared reports. Derive job labels from the assignment and report state. Start an unassigned job, assign a mechanic, then move through draft and submitted. The owner can close a reviewed job. Customer share access follows the share record independently of job closure.

### Evidence handling

- Start with up to five JPG/PNG photos at 5 MiB each and one MP4 clip at 30 MiB. These are proposed demo limits. Confirm the chosen camera can export a short sample as a playable MP4 on target devices before locking them.
- Keep uploads in `backend/.local/inspection-evidence`. The existing request attachment adapter accepts JPG and PNG keys. Reuse its private-file pattern and existing photo validation where applicable, and add a dedicated adapter and size-limited upload route for inspection evidence. Avoid increasing the global JSON limit. [Current attachment adapter](../backend/src/modules/requests/attachment-storage.ts) · [OWASP file upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- Verify file content and size on the server, generate storage keys, and clean up files if the database write fails. Serve files via authenticated routes. Use download as the baseline for clips and add inline playback if the authenticated media path works on the checked browsers.
- Record the customer's permission before capturing evidence and allow a text-only report. Keep video focused on the vehicle and use only intentionally selected evidence in a share. Use demo identities and media for the local presentation.

## What can happen before Part 2 merges

| Timing | Work |
| --- | --- |
| Before Fardin's merge | A separate `feature/garage-inspections` branch can hold this plan, a static customer `/garages` search prototype, the `G_db` app shell and role-specific mock screens, and a sample action-camera export check. Start `A_db` edits after Part 2 lands. Leave shared auth, API routing and migrations for integration. |
| After Fardin's merge | Update from Capstone's latest `main`. If the garage branch is local, rebase it. If it is already shared, merge `main` into it. Verify the three portals start against the existing local API before adding shared routing and migrations. |
| First implementation slice | Admin creates a garage and owner, owner signs in to `G_db`, and a complete profile appears in customer search. Add expiry, termination and credential reset. |
| Second implementation slice | Owner creates mechanic credentials, takes in a vehicle and assigns the job. The mechanic signs in to `G_db` and submits a text report. |
| Third implementation slice | Private photos, report review and selective customer sharing. Add the short video upload and retry after the photo flow passes, then verify revocation. |

Merge the garage feature after the Part 2 integration, local migration and regression checks pass. Keep the existing Parts Ark repository and production services outside this workflow.

## Demo and acceptance

1. Create a garage in admin with a duration and manual fee. Check that a partial profile stays hidden and a complete profile appears automatically for the matching area and service.
2. Sign in through the Owner choice, create a mechanic, and assign a job. Confirm the mechanic can sign in through the Mechanic choice, while a wrong role selection and a mechanic from another garage are denied.
3. At mobile width, submit a report with a specific finding and a photo. Exercise a failed upload and retry. Run the same flow with the selected camera's sample MP4 when video lands.
4. As owner, share the summary and one file. Confirm the intended customer sees those items, and a different customer and signed-out visitors cannot access them. Revoke the share and verify both the report and file URLs are denied.
5. Reset an owner's password and verify the old session is invalid. Verify expiry and termination block both garage roles and hide both directory surfaces.
6. Check the new flows at 320 px and a typical phone width, plus desktop and keyboard navigation. Run frontend builds and type checks, backend integration tests on a separate database, and a smoke check of existing storefront, supplier and admin flows. Use responsive browser testing for the local demo. Physical-phone testing requires an explicitly configured connection to the local development host.

Review the dashboard wireframes and shortlist of service labels together before implementation. The first milestone is an admin-created garage whose owner can sign in and save a profile that customers can find.
