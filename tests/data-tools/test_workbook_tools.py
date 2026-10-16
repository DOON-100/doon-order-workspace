"""Synthetic-only integration coverage for portable workbook commands."""

import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import openpyxl
from openpyxl.drawing.image import Image as ExcelImage
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "data-tools" / "workbook.py"
SPEC = importlib.util.spec_from_file_location("data_workbook", SCRIPT)
tool = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tool)
SS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


def fixture(folder):
    folder.mkdir(parents=True)
    path = folder / "synthetic input with spaces.xlsx"
    picture = folder / "source image.png"
    Image.new("RGB", (8, 6), "#2288cc").save(picture)
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "Synthetic items"
    sheet.append(["Synthetic label", "Quantity", "Computed", "Missing cache"])
    sheet.append(["PRIVATE_SYNTHETIC_CELL", 7, "=B2*6", "=B2+1"])
    sheet.append(["Second", 2, "=B3*2", None])
    sheet["C2"].number_format = "0.00"
    sheet.freeze_panes = "B2"
    sheet.add_image(ExcelImage(str(picture)), "B2")
    other = workbook.create_sheet("Synthetic lookup")
    other.append(["Key", "Value"])
    other.append(["A", 10])
    workbook.save(path)
    workbook.close()
    with zipfile.ZipFile(path) as archive:
        parts = {name: archive.read(name) for name in archive.namelist()}
    root = ET.fromstring(parts["xl/worksheets/sheet1.xml"])
    for cell in root.iter(f"{{{SS}}}c"):
        if cell.get("r") == "C2":
            cell.find(f"{{{SS}}}v").text = "42"
    parts["xl/worksheets/sheet1.xml"] = ET.tostring(root, encoding="utf-8")
    # This is the synthesized fixture, not a production or supplied input.
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in parts.items():
            archive.writestr(name, data)
    return path, picture.read_bytes()


class WorkbookToolsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="workbook-tool-test-")
        self.root = Path(self.temp.name)
        self.source, self.image_bytes = fixture(self.root / "input folder")
        self.original = self.source.read_bytes()

    def tearDown(self):
        self.assertEqual(self.source.read_bytes(), self.original)
        self.temp.cleanup()

    def test_rows_keep_formula_and_existing_cache_separate(self):
        output = self.root / "output folder" / "rows.json"
        result = tool.run("rows", self.source, output, ["Synthetic items"], "B2:D3")
        self.assertEqual(result["rowCount"], 2)
        payload = json.loads(output.read_text(encoding="utf-8"))
        self.assertFalse(payload["formulaCachesRecalculated"])
        cells = {cell["coordinate"]: cell for row in payload["sheets"][0]["rows"] for cell in row["cells"]}
        self.assertEqual(cells["B2"]["value"], 7)
        self.assertIsNone(cells["B2"]["formula"])
        self.assertEqual(cells["C2"]["formula"], "=B2*6")
        self.assertIsNone(cells["C2"]["value"])
        self.assertEqual(cells["C2"]["cachedValue"], 42)
        self.assertIsNone(cells["D2"]["cachedValue"])
        self.assertEqual(cells["C2"]["numberFormat"], "0.00")

    def test_inspect_selected_sheet_and_header(self):
        output = self.root / "inspect.json"
        result = tool.run("inspect", self.source, output, ["Synthetic items"], "A1:D3")
        self.assertEqual(result["sheetCount"], 1)
        sheet = json.loads(output.read_text(encoding="utf-8"))["sheets"][0]
        self.assertEqual(sheet["formulaCells"], 3)
        self.assertEqual(sheet["missingFormulaCaches"], 2)
        self.assertEqual(sheet["imageCount"], 1)
        self.assertEqual(sheet["headers"][0]["value"], "Synthetic label")

    def test_images_are_package_relative_and_byte_preserved(self):
        output = self.root / "outputs with spaces" / "image package"
        result = tool.run("images", self.source, output, ["Synthetic items"])
        self.assertEqual(result["imageCount"], 1)
        manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
        entry = manifest["images"][0]
        self.assertFalse(Path(entry["path"]).is_absolute())
        self.assertNotIn("..", Path(entry["path"]).parts)
        self.assertNotIn(str(self.root), json.dumps(manifest))
        self.assertEqual((output / entry["path"]).read_bytes(), self.image_bytes)
        self.assertEqual(entry["sha256"], hashlib.sha256(self.image_bytes).hexdigest())
        self.assertEqual(entry["anchor"]["row"], 2)
        self.assertEqual(entry["anchor"]["column"], 2)
        with self.assertRaises(FileExistsError):
            tool.run("images", self.source, output)

    def test_image_range_filters_anchor(self):
        output = self.root / "filtered images"
        summary = tool.run("images", self.source, output, selected_range="C1:D4")
        self.assertEqual(summary["imageCount"], 0)
        self.assertEqual(json.loads((output / "manifest.json").read_text())["images"], [])

    def test_missing_or_duplicate_sheet_leaves_no_output(self):
        for index, selection in enumerate((["No such sheet"], ["Synthetic items", "Synthetic items"])):
            output = self.root / f"bad-{index}.json"
            with self.assertRaises(ValueError):
                tool.run("rows", self.source, output, selection)
            self.assertFalse(output.exists())

    def test_invalid_range_or_header_leaves_no_output(self):
        for index, selected_range in enumerate(("A:D", "4:8", "Z5:A2", "A0:B2", "XFE1:XFE2")):
            output = self.root / f"bad-range-{index}.json"
            with self.assertRaises(ValueError):
                tool.run("rows", self.source, output, selected_range=selected_range)
            self.assertFalse(output.exists())
        with self.assertRaises(ValueError):
            tool.run("rows", self.source, self.root / "bad-header.json", header_row=-1)

    def test_original_and_existing_destinations_cannot_be_overwritten(self):
        for command in ("inspect", "rows", "images"):
            with self.assertRaises(ValueError):
                tool.run(command, self.source, self.source)
        destination = self.root / "existing.json"
        destination.write_bytes(b"original output")
        with self.assertRaises(FileExistsError):
            tool.run("inspect", self.source, destination)
        self.assertEqual(destination.read_bytes(), b"original output")

    def test_cli_works_from_unrelated_directory_and_stdout_has_no_cells(self):
        outside = self.root / "unrelated working directory"
        outside.mkdir()
        output = self.root / "another directory" / "result with spaces.json"
        result = subprocess.run([sys.executable, str(SCRIPT), "rows", "--input", str(self.source),
                                 "--output", str(output), "--sheet", "Synthetic items", "--range", "A1:D3"],
                                cwd=outside, capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["rowCount"], 2)
        self.assertNotIn("PRIVATE_SYNTHETIC_CELL", result.stdout)
        self.assertNotIn("Synthetic items", result.stdout)
        self.assertTrue(output.is_file())

    def test_cli_errors_do_not_print_private_selection(self):
        output = self.root / "not-created.json"
        result = subprocess.run([sys.executable, str(SCRIPT), "rows", "--input", str(self.source),
                                 "--output", str(output), "--sheet", "PRIVATE_UNKNOWN_SHEET"],
                                capture_output=True, text=True, encoding="utf-8")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("PRIVATE_UNKNOWN_SHEET", result.stdout + result.stderr)
        self.assertFalse(output.exists())

    def test_zero_header_and_blank_row_control(self):
        output = self.root / "no-header.json"
        tool.run("rows", self.source, output, ["Synthetic lookup"], "A1:B4", header_row=0, include_empty=True)
        sheet = json.loads(output.read_text(encoding="utf-8"))["sheets"][0]
        self.assertEqual(sheet["headers"], [])
        self.assertEqual(len(sheet["rows"]), 4)


if __name__ == "__main__":
    unittest.main()
