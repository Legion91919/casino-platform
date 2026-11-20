#!/usr/bin/env python3
"""Contract checks for the suite (run in CI on every push; no network).

1. Every event schema in contracts/events is valid JSON Schema 2020-12 and resolves its $refs.
2. Every examples/*.valid.json passes its schema; every *.invalid.json fails it.
3. Every services/*/api/openapi.yaml is valid OpenAPI 3.1 (openapi-spec-validator if installed,
   otherwise a structural check).
4. Every event named in contracts/README.md has a schema file, and vice versa.
5. Ownership: every services/<name>/ has a CODEOWNERS line, a baton, an OpenAPI file, a migration and DB tests.

Usage: python3 tools/validate-contracts.py   (exit code 1 on any failure)
"""
import json
import pathlib
import re
import sys

import yaml
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

ROOT = pathlib.Path(__file__).resolve().parent.parent
EVENTS = ROOT / "contracts" / "events"
failures = []


def fail(msg):
    failures.append(msg)
    print(f"FAIL  {msg}")


def kebab(name):
    return re.sub(r"(?<!^)(?=[A-Z])", "-", name).lower()


schemas = {p.name: json.loads(p.read_text()) for p in sorted(EVENTS.glob("*.schema.json"))}
registry = Registry().with_resources((s["$id"], Resource.from_contents(s)) for s in schemas.values())

for name, schema in schemas.items():
    try:
        Draft202012Validator.check_schema(schema)
        print(f"ok    schema   {name}")
    except Exception as exc:  # noqa: BLE001
        fail(f"schema {name}: {exc}")

for example in sorted((EVENTS / "examples").glob("*.json")):
    event = example.name.split(".")[0]
    schema = schemas.get(f"{event}.v1.schema.json")
    if schema is None:
        fail(f"example {example.name}: no schema for {event}")
        continue
    validator = Draft202012Validator(schema, registry=registry, format_checker=FormatChecker())
    errors = list(validator.iter_errors(json.loads(example.read_text())))
    expect_valid = example.name.endswith(".valid.json")
    if expect_valid and errors:
        fail(f"example {example.name} should pass: {errors[0].message}")
    elif not expect_valid and not errors:
        fail(f"example {example.name} should fail but passed")
    else:
        print(f"ok    example  {example.name}" + ("" if expect_valid else f"  (rejected: {errors[0].message[:70]})"))

try:
    from openapi_spec_validator import validate as validate_openapi
except ImportError:  # structural fallback
    validate_openapi = None

for spec_path in sorted(ROOT.glob("services/*/api/openapi.yaml")):
    spec = yaml.safe_load(spec_path.read_text())
    label = spec_path.relative_to(ROOT)
    try:
        if not str(spec.get("openapi", "")).startswith("3.1"):
            raise ValueError("openapi must be 3.1.x")
        if not spec.get("paths"):
            raise ValueError("no paths")
        if validate_openapi:
            validate_openapi(spec)
        print(f"ok    openapi  {label}  ({len(spec['paths'])} paths)")
    except Exception as exc:  # noqa: BLE001
        fail(f"openapi {label}: {str(exc)[:200]}")

readme = (ROOT / "contracts" / "README.md").read_text()
documented = set(re.findall(r"^\| `([A-Z][A-Za-z]+)` v1 \|", readme, flags=re.M))
on_disk = {schemas[n]["title"].split()[0] for n in schemas if n != "envelope.v1.schema.json"}
for missing in sorted(on_disk - documented):
    fail(f"{missing} has a schema but no row in contracts/README.md")
for missing in sorted(documented - on_disk):
    fail(f"{missing} is in contracts/README.md but has no schema ({kebab(missing)}.v1.schema.json)")
if documented == on_disk:
    print(f"ok    readme   {len(documented)} events documented with publisher and consumers")

codeowners = (ROOT / ".github" / "CODEOWNERS").read_text()
for svc in sorted(p.name for p in (ROOT / "services").iterdir() if p.is_dir()):
    needed = [f"services/{svc}/.agentic/product.md", f"services/{svc}/api/openapi.yaml",
              f"services/{svc}/db/migrations/V001__init.sql"]
    missing = [n for n in needed if not (ROOT / n).exists()]
    if f"/services/{svc}/ " not in codeowners:
        missing.append("CODEOWNERS line")
    if not list((ROOT / "services" / svc / "db" / "tests").glob("*.sql")):
        missing.append("db/tests/*.sql")
    if missing:
        fail(f"service {svc} is missing: {', '.join(missing)}")
    else:
        print(f"ok    owner    services/{svc}")

print(f"\n{'FAILED' if failures else 'all contract checks passed'} ({len(failures)} failure(s))")
sys.exit(1 if failures else 0)
