# Phygii feature details — read-only browser audit

Observed in the user's existing signed-in Chrome tab on 2026-10-20. This document records control labels and behavior only. It omits customer names, personal details, answer text, addresses, URL IDs, complete model/share links, and file contents. No production create/edit/save/upload/generate/delete/release/copy/invite/send action was taken. Menus, filters, existing document-version lists, and one edit form were **opened only for inspection**; the form was cancelled without saving. “Saw” means displayed in the browser; “Inferred” is a cautious interpretation; “Unknown” was not established.

**Screenshot handling:** No screenshot was saved. The connected browser tools can display screenshots inline but did not provide a verified way to save a crop with customer details removed. Saving an unredacted page would violate this audit's privacy rule. Each section therefore identifies a safe screenshot target but does not claim that a file exists.

## 1. Survey response report (“Generate Report”)

### Exact labels

“GENERATE REPORT” (rendered button); “Documents”; “Reports”; “Document versions”; “No document versions”; report-version menu: “Download”, “Edit”, “Delete”.

### What I saw

- A completed response page had a “GENERATE REPORT” button. No adjacent report options, selection controls, or existing-report link appeared on that response page before pressing the button. I did **not** press it.
- In one completed project's “Documents” tab, a “Reports” card expanded to “No document versions”.
- In another accessible project's “Documents” tab, the “Reports” card contained three existing “Document versions”. Their displayed filenames ended in `.pdf`. A version's action menu offered only “Download”, “Edit”, and “Delete”; no “View”, “Open”, or in-browser preview action was visible. I did not use any of those actions.

### Inferred

The listed versions are likely generated or uploaded report PDFs, but their origin and relationship to “GENERATE REPORT” were not demonstrated.

### Unknown

The PDF's first page; section/task/repeated-task layout; photo dimensions and captions; whether sections or photos can be selected; report-generation options; and whether a safe in-browser preview exists elsewhere. Opening the observed version would have required “Download”, which this task forbids as copying. No report was generated.

### Screenshot notes

A privacy-safe crop would show only “GENERATE REPORT”, the “Reports” card, and the version menu—not filenames or site details. **No file saved.**

## 2. Media gallery (location “Media” tab)

### Exact labels

Filters and observed choices on the inspected location:

| On-screen filter | Observed options or state |
| --- | --- |
| “Flag” | “All”, “Flagged”, “Not Flagged” |
| “Media Type” | “All”, “Project Photos”, “HD Images”, “360 Images” (multi-select checkboxes) |
| “Level” | “Ground”, “Level 1”, “Roof”, “Aerial” |
| “Area” | “Interior”, “Exterior” |
| “Type” | “Inspection” |
| “Category” | “HVAC”, “Electrical”, “Cabling Racks”, “Fire Extinguishers”, “Gas Meter”, “Electric Meter”, “Thermostats”, “Cases”, “Reach in - MT”, “Reach in - Frozen”, “Interior Lighting”, “Exterior Lighting”, “Cabinets”, “Gas Dispensers” |
| “Tag” | Disabled; no options exposed |
| “Sort By” | “Date Ascending”, “Date Descending”, “Media Type”, “Level”, “Area”, “Type”, “Category” |
| Thumbnail size | An unlabeled slider; accessibility value 125. Read-only DOM attributes showed min 50, max 200, step `any`; those bounds were not printed beside the slider. |

Photo-detail labels and controls observed: “INFO”, “Date Captured”, “Level”, “Area”, “Category”, “View All Comments”, “Create Comment”. A “Map View” link was present in the location header, not identified as this photo's map-position control.

### What I saw

- “Media Type” selected all three media classes in its default “All” state. “Tag” was disabled on this location.
- “Type” and “Category” were distinct filter controls. This location's “Type” menu exposed “Inspection”; “Category” exposed the listed equipment/asset group labels.
- Double-clicking one gallery thumbnail opened a media detail overlay. Its “INFO” area displayed a capture date/time, level, area, category, and comments controls. The underlying photo and any private metadata values were not retained.
- No photographer/uploader field, tag value, or per-photo map coordinates were identified in that inspected detail view.

### Inferred

“Type” appears to be a broad media classification and “Category” a more specific subject grouping. “Flagged”/“Not Flagged” implies a binary flag state. The purpose of the flag (quality review, issue marking, favorites, or something else) was **not** explained by a visible tooltip and remains unverified.

### Unknown

Whether all locations offer the same options; exact “Type” versus “Category” data rules; who can flag media and what flagging does; whether tags or photographer/uploader appear for other media; how photo map position is represented; exact sort stability; and how slider values translate into thumbnail pixel dimensions.

### Screenshot notes

A safe crop would include only the filter row and open menus, with the header, thumbnails, and private imagery excluded. **No file saved.**

## 3. Field capture

### Exact labels

“Help”; “Images”; “uploaded”; “captured”; “Skip Metadata Capture”; “Skip Marker Placement”; “Default Metadata”; “Target”.

### What I saw

- The response summary displayed separate image counts followed by “uploaded” and “captured”. They were equal in the inspected response; earlier read-only samples were also equal. Numeric counts are intentionally omitted.
- A task's expanded configuration displayed “Skip Metadata Capture” and “Skip Marker Placement”. Neither heading nor its immediate container exposed a title, description, or help icon in the inspected DOM. “Default Metadata” and “Target” were nearby expandable sections.
- Clicking the dashboard “Help” control produced no help panel or mobile-app link in the selected tab. No mobile application was installed or searched for outside this tab.

### Inferred

“captured” and “uploaded” likely represent different steps of image handling, but equal examples do not prove offline queuing or synchronization. The “Skip…” labels suggest task-level capture behavior switches, but their actual effects were not tested.

### Unknown

Whether Phygii has an iOS/Android field-capture app; whether captured and uploaded ever differ; exact counting rules; and the meanings/effects of “Skip Metadata Capture” and “Skip Marker Placement”. No tooltip or help text defining either was visible.

### Screenshot notes

A safe crop would isolate the “Images” counters' labels or the two “Skip…” headings while masking values and question text. **No file saved.**

## 4. Copying a setup

### Exact labels