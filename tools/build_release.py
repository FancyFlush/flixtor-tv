"""Build a signed personal APK, keeping signing material outside the project."""
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess

root = Path(__file__).resolve().parents[1]
private = Path.home() / ".local" / "share" / "flixtor-tv"
private.mkdir(parents=True, exist_ok=True, mode=0o700)
private.chmod(0o700)
config = private / "signing.json"
env = os.environ.copy()
# Local build settings never enter tracked source.
local_env = root / ".env"
if local_env.exists():
    import shlex
    for line in local_env.read_text().splitlines():
        if line.startswith("TV_") and "=" in line:
            name, value = line.split("=", 1)
            parsed = shlex.split(value, comments=True)
            env.setdefault(name, parsed[0] if parsed else "")
if not env.get("JAVA_HOME"):
    java_home = Path("/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home")
    if java_home.exists():
        env["JAVA_HOME"] = str(java_home)
if not config.exists():
    password = secrets.token_urlsafe(32)
    values = {"TV_KEYSTORE": str(private / "personal.p12"), "TV_KEY_ALIAS": "personal-tv",
              "TV_STORE_PASSWORD": password, "TV_KEY_PASSWORD": password}
    # Persist before key generation so a failed build never loses its key credentials.
    with open(config, "x", opener=lambda p, flags: os.open(p, flags, 0o600)) as output:
        json.dump(values, output)
else:
    values = json.loads(config.read_text())
env.update(values)
if not Path(values["TV_KEYSTORE"]).exists():
    env.update(values)
    keytool = str(Path(env["JAVA_HOME"]) / "bin" / "keytool") if env.get("JAVA_HOME") else "keytool"
    subprocess.run([keytool, "-genkeypair", "-noprompt", "-storetype", "PKCS12",
                    "-keystore", values["TV_KEYSTORE"], "-alias", values["TV_KEY_ALIAS"],
                    "-storepass:env", "TV_STORE_PASSWORD", "-keypass:env", "TV_KEY_PASSWORD",
                    "-keyalg", "RSA", "-keysize", "3072", "-validity", "10000",
                    "-dname", "CN=Personal TV, OU=Personal, O=Personal, C=IE"], env=env, check=True)
    os.chmod(values["TV_KEYSTORE"], 0o600)
subprocess.run([str(root / "android/gradlew"), ":app:assembleRelease", "--console=plain"], cwd=root / "android", env=env, check=True)
release_dir = root / "android/app/build/outputs/apk/release"
apk = release_dir / "flixtor.apk"
shutil.copy2(release_dir / "app-release.apk", apk)
import hashlib
apk.with_suffix(".apk.sha256").write_text(hashlib.sha256(apk.read_bytes()).hexdigest() + "  flixtor.apk\n")
release_tag = env.get("TV_RELEASE_TAG")
if release_tag:
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,100}", release_tag):
        raise ValueError("TV_RELEASE_TAG must be a simple Git tag")
    apk_name = env.get("TV_RELEASE_APK_NAME", "flixtor.apk")
    if apk_name not in {"flixtor.apk", "app-release.apk"}:
        raise ValueError("TV_RELEASE_APK_NAME must be flixtor.apk or app-release.apk")
    release_apk = release_dir / apk_name
    metadata = {
        "versionCode": int(env.get("TV_VERSION_CODE", "1002")),
        "versionName": env.get("TV_VERSION_NAME", "1.0.2"),
        "minSdk": 29,
        "sha256": hashlib.sha256(release_apk.read_bytes()).hexdigest(),
        "commit": env.get("TV_COMMIT_SHA", "local"),
        "apkUrl": f"https://github.com/FancyFlush/flixtor-tv/releases/download/{release_tag}/{apk_name}",
    }
    (release_dir / "release.json").write_text(json.dumps(metadata, indent=2) + "\n")
print("Signed APK: android/app/build/outputs/apk/release/flixtor.apk")
print("Signing material: ~/.local/share/flixtor-tv/ — back up securely for future updates.")
