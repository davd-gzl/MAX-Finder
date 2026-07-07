# Publishing MAX Finder (GitHub Releases + F-Droid)

There are two independent Android distribution channels. They are **signed by
different keys**, so a user must pick one and stick with it (see
[Signing & the two channels](#signing--the-two-channels)).

1. **GitHub Releases** — you build and sign the APK; the
   [`Release Android APK`](../.github/workflows/release-apk.yml) workflow attaches
   it to the Release automatically. Signing is **required** — the workflow fails
   early if the keystore secrets below are not configured.
2. **F-Droid** — F-Droid's servers build the APK **from the tagged source** and
   sign it with F-Droid's key. Your GitHub Action is *not* involved.

---

## Release process (do this for every version)

F-Droid builds the committed source, so the version must live in the repo — not
be injected by CI.

1. **Bump the version** in [`android/app/build.gradle`](../android/app/build.gradle):
   - `versionName` → the human string, e.g. `"0.2.0"` (keep it equal to the git tag without the `v`).
   - `versionCode` → an integer that **increases by at least 1 every release** (Android refuses to upgrade otherwise). e.g. `1` → `2`.
2. Commit, then tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
3. **Publish a GitHub Release** for that tag. The workflow builds, signs (if
   secrets are set), and attaches `max-finder-v0.2.0.apk`.
4. **For F-Droid**, add a new build entry with the same `versionCode`/`versionName`
   to the metadata in `fdroiddata` (see below). With `UpdateCheckMode: Tags` the
   F-Droid bot will also propose this for you.

---

## GitHub Releases: one-time signing setup

The release workflow **requires** a keystore and fails early without one (an
unsigned APK cannot be installed anyway). Set it up once:

1. **Generate a keystore once** (keep it forever — losing it means you can never
   upgrade the app for existing users):

   ```bash
   keytool -genkey -v -keystore max-finder.keystore \
     -alias max-finder -keyalg RSA -keysize 2048 -validity 10000
   base64 -w0 max-finder.keystore > keystore.b64   # macOS: base64 -i max-finder.keystore
   ```

   Store `max-finder.keystore` somewhere safe and offline. **Never commit it**
   (`*.keystore`, `*.jks`, `keystore.b64` are git-ignored).

2. **Add repo secrets** (Settings → Secrets and variables → Actions):

   | Secret | Value |
   | --- | --- |
   | `ANDROID_KEYSTORE_BASE64` | contents of `keystore.b64` |
   | `ANDROID_KEYSTORE_PASSWORD` | the store password you chose |
   | `ANDROID_KEY_ALIAS` | `max-finder` |
   | `ANDROID_KEY_PASSWORD` | the key password you chose |

The workflow decodes the keystore into a temp file and passes it to Gradle via
the `MAXFINDER_*` env vars that `build.gradle` reads. The secrets never appear in
logs and the keystore never touches the repo.

---

## F-Droid submission

F-Droid inclusion is a merge request to
[`fdroiddata`](https://gitlab.com/fdroid/fdroiddata), reviewed by F-Droid
maintainers. Below is a **starting-point** recipe — a Capacitor + Vite app needs
Node to build the web assets, which the F-Droid buildserver provides but which
often needs a round of iteration with the maintainers to get exactly right.

Create `metadata/org.maxfinder.app.yml` in `fdroiddata`:

```yaml
Categories:
  - Internet
  - Travel
License: MPL-2.0
AuthorName: MAX Finder contributors
SourceCode: https://github.com/davd-gzl/MAX-Finder
IssueTracker: https://github.com/davd-gzl/MAX-Finder/issues

AutoName: MAX Finder

RepoType: git
Repo: https://github.com/davd-gzl/MAX-Finder.git

Builds:
  - versionName: 0.1.0
    versionCode: 1
    commit: v0.1.0
    sudo:
      - apt-get update
      - apt-get install -y npm
    subdir: android/app
    gradle:
      - yes
    prebuild:
      - npm ci
      - npm run build:mobile
      - npx cap copy android
    scandelete:
      - node_modules

AutoUpdateMode: Version v%v
UpdateCheckMode: Tags
CurrentVersion: 0.1.0
CurrentVersionCode: 1
```

Notes / likely iteration points:

- **Node version.** The `apt` `npm` may be too old for Vite 6 (needs Node 18+).
  You may need to install a newer Node in `sudo:` (e.g. via NodeSource) — F-Droid
  maintainers will advise the approved approach for the current buildserver.
- **`prebuild` runs the web build** (`build:mobile` uses base `/`) and copies the
  assets into `android/` with `cap copy`, since `dist/` is not committed.
- **`scandelete: node_modules`** stops F-Droid's scanner from flagging bundled npm
  packages after the build.
- **No proprietary blobs.** The stack is MIT (Capacitor, Vite, Leaflet). The one
  binary in the repo is `android/gradle/wrapper/gradle-wrapper.jar` (standard
  Gradle wrapper, accepted by F-Droid).
- The store listing (title, descriptions) is pulled from
  [`fastlane/metadata/android/en-US/`](../fastlane/metadata/android/en-US). Add
  `phoneScreenshots/` and an `icon.png` there to enrich the F-Droid page.

Validate locally with `fdroid build -v -l org.maxfinder.app` (via
[`fdroidserver`](https://f-droid.org/docs/Building_Applications/)) before opening
the merge request.

---

## Signing & the two channels

- The **GitHub Release APK** is signed with *your* keystore.
- The **F-Droid APK** is signed with *F-Droid's* key.

Because Android ties upgrades to the signing key, a user who installed the GitHub
APK cannot update via F-Droid (or vice-versa) without uninstalling first. This is
normal for dual-channel FOSS apps. If you later want a single signature across
both, F-Droid supports [reproducible builds](https://f-droid.org/docs/Reproducible_Builds/)
where F-Droid ships *your* signature — a more advanced setup worth adding once the
basic recipe is merged.
