# Demos

The features of the web view, each one a demo: its script, `<name>/<name>.demo.ts`, the GitHub
answers it replays, `<name>/cache/`, and the screenshots of its key points, `<name>/screenshots/`,
below, as the Demos workflow took them (`npm run demo:screenshots`). The [README](../README.md)
says how to run a demo, and how to record one anew.

## The filter

[filter.demo.ts](filter/filter.demo.ts) (spec/web.md, Page; #9), on JetBrains/MPS: the skills whose name or first sentence contains the text, each match marked, how many are shown of all.

![all skills](filter/screenshots/01-all-skills.png)

![filtered by teamcity](filter/screenshots/02-filtered-by-teamcity.png)

![filtered by editor](filter/screenshots/03-filtered-by-editor.png)

![nothing kept](filter/screenshots/04-nothing-kept.png)

## The skill list

[skill-list.demo.ts](skill-list/skill-list.demo.ts) (spec/web.md, Page; #30), on JetBrains/MPS: a divider between two skills, each skill's copies as a badge after its name, their paths on hover and in its pane.

![the list](skill-list/screenshots/01-the-list.png)

![copies](skill-list/screenshots/02-copies.png)

![other copies](skill-list/screenshots/03-other-copies.png)

## The last update

[last-update.demo.ts](last-update/last-update.demo.ts) (spec/web.md, Page; spec/analysis.md, Last update; #23), on JetBrains/MPS: `Updated <date>` in the top right corner of the chosen skill, the time on hover.

![first skill](last-update/screenshots/01-first-skill.png)

![another skill](last-update/screenshots/02-another-skill.png)

## An organization

[organization.demo.ts](organization/organization.demo.ts) (spec/web.md, Organization page; #10), on JetBrains, cut to 34 of its repositories: each one's count as it is scanned, a scanned one a link to its page while the scan goes on, then Stop.

![scanning](organization/screenshots/01-scanning.png)

![scanned with skills](organization/screenshots/02-scanned-with-skills.png)

![repository page scan goes on](organization/screenshots/03-repository-page-scan-goes-on.png)

![back to organization](organization/screenshots/04-back-to-organization.png)

![stopped](organization/screenshots/05-stopped.png)

## Groups

[groups.demo.ts](groups/groups.demo.ts) (spec/web.md, Groups; spec/analysis.md, Group; #38), on JetBrains/youtrackdb, then on JetBrains, cut to 14 of its repositories: Group skills once a scan is over, a skill's SKILL.md from its group, Back to skills; for an organization, after Stop, the skills of the repositories scanned, each with its repository.

![skills](groups/screenshots/01-skills.png)

![groups](groups/screenshots/02-groups.png)

![skill from group](groups/screenshots/03-skill-from-group.png)

![back to skills](groups/screenshots/04-back-to-skills.png)

![organization scanning](groups/screenshots/05-organization-scanning.png)

![organization stopped](groups/screenshots/06-organization-stopped.png)

![organization groups](groups/screenshots/07-organization-groups.png)
