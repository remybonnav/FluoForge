# Contributing to FluoForge

Thank you for your interest in FluoForge.

## Contributor License Agreement

FluoForge is offered under AGPL-3.0-only and, separately, under a commercial licence (see [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md)). To keep offering the commercial licence, the project needs the right to relicense every contribution.

For that reason, **every outside contribution needs a signed Contributor License Agreement** ([CLA.md](CLA.md)) before it can be merged. This applies to code, documentation, tests and assets.

To sign it:

1. Read [CLA.md](CLA.md).
2. Fill in your details and sign it.
3. Send it to the maintainer at remybonnavion42@gmail.com.
4. Tick the CLA box in the pull request template.

If your employer has rights to your work, your employer must agree to the contribution as well.

## Working on the code

- Work on a branch made from `dev`, and open the pull request against `dev`.
- FluoForge runs in the browser without a build step:
  - Serve the folder with `python3 -m http.server 8765 --bind 127.0.0.1`.
  - Open `http://127.0.0.1:8765/`.
- Run every suite in `tests/browser-regression.html` before opening a pull request, and add checks for new behaviour.
- New source files start with this header, in the comment syntax of the file type:

  ```
  SPDX-License-Identifier: AGPL-3.0-only
  Copyright (C) 2026 Remy Bonnavion
  ```

- If you add a third-party library or font, add it to [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) with its version, licence and source. Its licence must be compatible with both AGPL-3.0 and the commercial licence; in practice, a permissive licence.
