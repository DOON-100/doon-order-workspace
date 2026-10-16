"""OOXML preservation tests made entirely from synthetic in-memory packages."""

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "data-tools" / "merge_workbooks.py"
SPEC = importlib.util.spec_from_file_location("merge_tools", SCRIPT)
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


def package(extra=False, name="Added", include_source=True):
    s, r = m.SS, m.DOCREL
    table_name = "SyntheticTable"
    data_sheet = 2 if extra and include_source else 1
    names = (["Source", name] if include_source else [name]) if extra else ["Source", "Lookup"]
    sheets = "".join(f'<sheet name="{item}" sheetId="{i}" r:id="rId{i}"/>' for i, item in enumerate(names, 1))
    rels = "".join(f'<Relationship Id="rId{i}" Type="{r}/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1, len(names) + 1))
    if not extra:
        rels += f'<Relationship Id="rId6" Type="{r}/externalLink" Target="externalLinks/externalLink1.xml"/>'
        rels += f'<Relationship Id="rId7" Type="{r}/calcChain" Target="calcChain.xml"/>'
    content_types = "".join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1, len(names) + 1))
    if not extra:
        content_types += '<Override PartName="/xl/externalLinks/externalLink1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml"/>'
        content_types += '<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/>'
    reference = "'Source'!B2" if extra else "1"
    definitions = f'<definedNames><definedName name="_xlnm.Print_Area" localSheetId="{data_sheet-1}">\'{names[data_sheet-1]}\'!$A$1:$B$3</definedName></definedNames>'
    external = '<externalReferences><externalReference r:id="rId6"/></externalReferences>' if not extra else ""
    parts = {
        "[Content_Types].xml": f'''<Types xmlns="{m.CT}">
          <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
          <Default Extension="xml" ContentType="application/xml"/>
          <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
          <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
          <Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>
          <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
          {content_types}</Types>''',
        "_rels/.rels": f'<Relationships xmlns="{m.REL}"><Relationship Id="rId1" Type="{r}/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        "xl/workbook.xml": f'<workbook xmlns="{s}" xmlns:r="{r}"><sheets>{sheets}</sheets>{definitions}{external}</workbook>',
        "xl/_rels/workbook.xml.rels": f'''<Relationships xmlns="{m.REL}">{rels}
          <Relationship Id="rId3" Type="{r}/styles" Target="styles.xml"/>
          <Relationship Id="rId4" Type="{r}/sharedStrings" Target="sharedStrings.xml"/>
        </Relationships>''',
        "xl/sharedStrings.xml": f'<sst xmlns="{s}" count="2" uniqueCount="2"><si><t>SYNTHETIC_PRIVATE_LABEL</t></si><si><r><rPr><b/></rPr><t>Amount</t></r></si></sst>',
        "xl/styles.xml": f'''<styleSheet xmlns="{s}">
          <numFmts count="1"><numFmt numFmtId="164" formatCode="0.000000"/></numFmts>
          <fonts count="1"><font><sz val="11"/><name val="Arial"/><color rgb="FF336699"/></font></fonts>
          <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
          <borders count="1"><border><left/><right/><top/><bottom/></border></borders>
          <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
          <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
          <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
          <dxfs count="1"><dxf><font><color rgb="FFFF0000"/></font></dxf></dxfs>
          <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
        </styleSheet>''',
        f"xl/worksheets/sheet{data_sheet}.xml": f'''<worksheet xmlns="{s}" xmlns:r="{r}">
          <cols><col min="1" max="2" width="18" customWidth="1" style="1"/></cols>
          <sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
          <row r="2" s="1" customFormat="1"><c r="A2"><v>1</v></c><c r="B2" s="1"><v>12.345678</v></c></row>
          <row r="3"><c r="A3"><v>2</v></c><c r="B3" s="1"><f>SUM({table_name}[Amount])+{reference}</f><v>99.25</v></c></row></sheetData>
          <conditionalFormatting sqref="B2:B3"><cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>0</formula></cfRule></conditionalFormatting>
          <hyperlinks><hyperlink ref="A1" r:id="rId2"/></hyperlinks>
          <tableParts count="1"><tablePart r:id="rId1"/></tableParts>
        </worksheet>''',
        f"xl/worksheets/_rels/sheet{data_sheet}.xml.rels": f'''<Relationships xmlns="{m.REL}">
          <Relationship Id="rId1" Type="{r}/table" Target="../tables/table1.xml"/>
          <Relationship Id="rId2" Type="{r}/hyperlink" Target="https://example.invalid/synthetic" TargetMode="External"/>
        </Relationships>''',
        "xl/tables/table1.xml": f'''<table xmlns="{s}" id="1" name="{table_name}" displayName="{table_name}" ref="A1:B2" totalsRowShown="0">
          <autoFilter ref="A1:B2"/><tableColumns count="2"><tableColumn id="1" name="Label"/><tableColumn id="2" name="Amount"/></tableColumns>
          <tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/>
        </table>''',
    }
    for index in range(1, len(names) + 1):
        parts.setdefault(f"xl/worksheets/sheet{index}.xml", f'<worksheet xmlns="{s}"><sheetData/></worksheet>')
    if not extra:
        parts["xl/externalLinks/externalLink1.xml"] = f'<externalLink xmlns="{s}" xmlns:r="{r}"><externalBook r:id="rId1"><sheetNames><sheetName val="SyntheticExternal"/></sheetNames></externalBook></externalLink>'
        parts["xl/externalLinks/_rels/externalLink1.xml.rels"] = f'<Relationships xmlns="{m.REL}"><Relationship Id="rId1" Type="{r}/externalLinkPath" Target="file:///synthetic/never-read.xlsx" TargetMode="External"/></Relationships>'
        parts["xl/calcChain.xml"] = f'<calcChain xmlns="{s}"><c r="B3" i="1"/></calcChain>'
    return {name: data.encode("utf-8") for name, data in parts.items()}


def save(path, parts):
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "x", zipfile.ZIP_DEFLATED) as archive:
        for name, data in parts.items():
            archive.writestr(name, data)


class MergeWorkbooksTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="merge-tool-test-")
        self.root = Path(self.temp.name)
        self.original = self.root / "inputs with spaces" / "original.xlsx"
        self.extra = self.root / "different inputs" / "extra.xlsx"
        self.original_parts = package()
        save(self.original, self.original_parts)
        save(self.extra, package(extra=True))
        self.original_bytes, self.extra_bytes = self.original.read_bytes(), self.extra.read_bytes()

    def tearDown(self):
        self.assertEqual(self.original.read_bytes(), self.original_bytes)
        self.assertEqual(self.extra.read_bytes(), self.extra_bytes)
        self.temp.cleanup()

    def test_preserves_original_parts_formulas_caches_styles_and_external_links(self):
        output = self.root / "output folder" / "merged.xlsx"
        report = m.merge(self.original, self.extra, output, "Source")
        self.assertTrue(report["original_input_unchanged"])
        self.assertTrue(report["extra_input_unchanged"])
        self.assertEqual(len(report["added_sheets"]), 1)
        newname = report["table_name_mapping"]["SyntheticTable"]
        self.assertNotEqual(newname, "SyntheticTable")
        with zipfile.ZipFile(output) as archive:
            parts = {name: archive.read(name) for name in archive.namelist()}
        for name, data in self.original_parts.items():
            if name not in report["original_parts_changed"]:
                self.assertEqual(parts[name], data, name)
        self.assertEqual(parts["xl/worksheets/sheet1.xml"], self.original_parts["xl/worksheets/sheet1.xml"])
        self.assertEqual(parts["xl/externalLinks/externalLink1.xml"], self.original_parts["xl/externalLinks/externalLink1.xml"])
        workbook, sheets = m.workbook_sheets(parts)
        self.assertEqual([sheet["name"] for sheet in sheets], ["Source", "Lookup", "Added"])
        sheet = m.parse(parts[sheets[-1]["path"]])
        cells = {cell.get("r"): cell for cell in sheet.iter(m.q("c"))}
        self.assertEqual(cells["A1"].get("t"), "inlineStr")
        self.assertEqual("".join(cells["A1"].find(m.q("is")).itertext()), "SYNTHETIC_PRIVATE_LABEL")
        self.assertIn(newname + "[Amount]", cells["B3"].find(m.q("f")).text)
        self.assertEqual(cells["B3"].find(m.q("v")).text, "99.25")
        print_area = next(item for item in workbook.find(m.q("definedNames")) if item.get("localSheetId") == "2")
        self.assertIn("Added", print_area.text)
        styles = m.parse(parts["xl/styles.xml"])
        style = styles.find(m.q("cellXfs"))[int(cells["B2"].get("s"))]
        fmt = next(item for item in styles.find(m.q("numFmts")) if item.get("numFmtId") == style.get("numFmtId"))
        self.assertEqual(fmt.get("formatCode"), "0.000000")
        rule = next(sheet.iter(m.q("cfRule")))
        self.assertGreater(int(rule.get("dxfId")), 0)
        relations = m.relationships(parts, sheets[-1]["path"])
        self.assertTrue(any(rel.get("TargetMode") == "External" for rel in relations.values()))
        self.assertTrue(output.with_suffix(".merge-validation.json").is_file())

    def test_second_import_handles_table_id_name_and_path_collisions(self):
        first = self.root / "first.xlsx"
        m.merge(self.original, self.extra, first, "Source")
        another = self.root / "another.xlsx"
        save(another, package(extra=True, name="Another"))
        second = self.root / "second.xlsx"
        m.merge(first, another, second, "Source")
        with zipfile.ZipFile(second) as archive:
            tables = [m.parse(archive.read(name)) for name in archive.namelist() if name.startswith("xl/tables/") and name.endswith(".xml")]
        self.assertEqual(len({table.get("id") for table in tables}), len(tables))
        self.assertEqual(len({table.get("name").casefold() for table in tables}), len(tables))

    def test_no_omission_is_default(self):
        extra = self.root / "without temporary source.xlsx"
        save(extra, package(extra=True, include_source=False))
        report = m.merge(self.original, extra, self.root / "all-sheets.xlsx")
        self.assertIsNone(report["omitted_extra_sheet"])
        self.assertEqual([sheet["name"] for sheet in report["added_sheets"]], ["Added"])

    def test_omitted_sheet_must_exist_in_both_workbooks(self):
        for omit in ("Missing", "Lookup"):
            output = self.root / (omit + ".xlsx")
            with self.assertRaises(ValueError):
                m.merge(self.original, self.extra, output, omit)
            self.assertFalse(output.exists())

    def test_input_output_and_report_overwrites_are_refused(self):
        for output in (self.original, self.extra):
            with self.assertRaises(ValueError):
                m.merge(self.original, self.extra, output, "Source")
        output = self.root / "existing.xlsx"
        output.write_bytes(b"unchanged output")
        with self.assertRaises(FileExistsError):
            m.merge(self.original, self.extra, output, "Source")
        self.assertEqual(output.read_bytes(), b"unchanged output")
        output2 = self.root / "report-collision.xlsx"
        report = output2.with_suffix(".merge-validation.json")
        report.write_bytes(b"unchanged report")
        with self.assertRaises(FileExistsError):
            m.merge(self.original, self.extra, output2, "Source")
        self.assertFalse(output2.exists())
        self.assertEqual(report.read_bytes(), b"unchanged report")

    def test_unsupported_new_drawing_fails_before_output(self):
        parts = package(extra=True)
        filename = "xl/worksheets/_rels/sheet2.xml.rels"
        root = m.parse(parts[filename])
        root.append(m.ET.Element(m.q("Relationship", m.REL), {"Id": "rId3", "Type": m.DOCREL + "/drawing", "Target": "../drawings/drawing1.xml"}))
        parts[filename] = m.serialize(root)
        extra = self.root / "unsupported.xlsx"
        save(extra, parts)
        output = self.root / "not-written.xlsx"
        with self.assertRaises(ValueError):
            m.merge(self.original, extra, output, "Source")
        self.assertFalse(output.exists())

    def test_different_date_system_and_duplicate_names_are_refused(self):
        parts = package(extra=True)
        root = m.parse(parts[m.WORKBOOK])
        root.insert(0, m.ET.Element(m.q("workbookPr"), {"date1904": "1"}))
        parts[m.WORKBOOK] = m.serialize(root)
        extra = self.root / "different dates.xlsx"
        save(extra, parts)
        with self.assertRaises(ValueError):
            m.merge(self.original, extra, self.root / "dates-output.xlsx", "Source")
        with self.assertRaises(ValueError):
            m.merge(self.original, self.extra, self.root / "duplicate-output.xlsx")

    def test_cli_from_unrelated_cwd_prints_only_summary(self):
        cwd = self.root / "unrelated cwd"
        cwd.mkdir()
        output = self.root / "new destination" / "merged with spaces.xlsx"
        result = subprocess.run([sys.executable, str(SCRIPT), str(self.original), str(self.extra), str(output),
                                 "--omit-sheet", "Source"], cwd=cwd, capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["added_sheet_count"], 1)
        self.assertNotIn("SYNTHETIC_PRIVATE_LABEL", result.stdout)
        self.assertNotIn("Added", result.stdout)

    def metadata_extra(self, reference=None):
        parts = package(extra=True)
        relations = m.parse(parts[m.WORKBOOK_RELS])
        relations.append(m.ET.Element(m.q("Relationship", m.REL), {
            "Id": "rId8", "Type": m.DOCREL + "/sheetMetadata", "Target": "metadata.xml"}))
        parts[m.WORKBOOK_RELS] = m.serialize(relations)
        parts["xl/metadata.xml"] = f'<metadata xmlns="{m.SS}"/>'.encode()
        if reference:
            sheet = m.parse(parts["xl/worksheets/sheet2.xml"])
            next(sheet.iter(m.q("c"))).set(reference, "1")
            parts["xl/worksheets/sheet2.xml"] = m.serialize(sheet)
        path = self.root / f"metadata-{reference or 'unused'}.xlsx"
        save(path, parts)
        return path

    def test_unused_sheet_metadata_can_be_omitted(self):
        extra = self.metadata_extra()
        output = self.root / "no-metadata-needed.xlsx"
        m.merge(self.original, extra, output, "Source")
        with zipfile.ZipFile(output) as archive:
            self.assertNotIn("xl/metadata.xml", archive.namelist())

    def test_referenced_sheet_metadata_is_rejected_without_output(self):
        for reference in ("cm", "vm"):
            extra = self.metadata_extra(reference)
            output = self.root / f"metadata-{reference}-output.xlsx"
            with self.assertRaises(ValueError):
                m.merge(self.original, extra, output, "Source")
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
