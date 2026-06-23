import { describe, it, expect } from "vitest";
import { inferType } from "./inferType";
import { analyse, XmlParseError } from "./analyse";
import { lineDiff, schemaDiff, contentType, prettyXml } from "./diff";
import { formatXml } from "./format";
import { markdownDoc, htmlDoc, jsonDump, textReport } from "./docgen";

describe("inferType", () => {
  it("classifies the documented types", () => {
    expect(inferType("42")).toBe("integer");
    expect(inferType("-3")).toBe("integer");
    expect(inferType("3.14")).toBe("float");
    expect(inferType("1.2e5")).toBe("float");
    expect(inferType("2024-01-15")).toBe("date");
    expect(inferType("2024-01-15T09:30:00")).toBe("datetime");
    expect(inferType("2024-01-15T09:30:00Z")).toBe("datetime");
    expect(inferType("true")).toBe("boolean");
    expect(inferType("YES")).toBe("boolean");
    expect(inferType("hello")).toBe("string");
    expect(inferType("")).toBe("empty");
    expect(inferType("   ")).toBe("empty");
  });
  it("treats bare 1/0 as integer (documented tie-break)", () => {
    expect(inferType("1")).toBe("integer");
    expect(inferType("0")).toBe("integer");
  });
});

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<order xmlns="http://ex.com/o" xmlns:c="http://ex.com/cust">
  <c:customer id="1" vip="true">
    <name>Alice</name>
    <phone type="mobile">555-1</phone>
    <phone type="home">555-2</phone>
  </c:customer>
  <c:customer id="2">
    <name>Bob</name>
    <phone type="mobile">555-3</phone>
  </c:customer>
  <total>99.50</total>
</order>`;

describe("analyse", () => {
  const r = analyse(SAMPLE, "sample.xml");

  it("captures top-level metadata", () => {
    expect(r.rootTag).toBe("order");
    expect(r.encoding).toBe("UTF-8");
    expect(r.totalElements).toBe(9); // order, 2x customer, 2x name, 3x phone, total
    expect(r.maxDepth).toBe(2);
  });

  it("strips namespaces from paths but reports namespaces", () => {
    expect(r.allPaths.has("/order/customer/phone")).toBe(true);
    const uris = r.namespaces.map((n) => n.uri).sort();
    expect(uris).toContain("http://ex.com/o");
    expect(uris).toContain("http://ex.com/cust");
  });

  it("infers required vs optional attributes", () => {
    const cust = r.pathStats.get("/order/customer")!;
    expect(cust.requiredAttrs.has("id")).toBe(true); // on both customers
    expect(cust.requiredAttrs.has("vip")).toBe(false); // only on first
    expect(r.allAttrPaths.has("/order/customer@id")).toBe(true);
  });

  it("computes cardinality (phone repeats 1..2 per customer)", () => {
    const phone = r.pathStats.get("/order/customer/phone")!;
    expect(phone.cardinality.min).toBe(1);
    expect(phone.cardinality.max).toBe(2);
    expect(phone.count).toBe(3);
    expect(phone.parents.has("/order/customer")).toBe(true);
  });

  it("tracks value frequency for enum-like fields", () => {
    const phone = r.pathStats.get("/order/customer/phone")!;
    const typeAttr = phone.attrs["type"];
    expect(Object.keys(typeAttr)).toContain("string");
    expect(r.pathStats.get("/order/total")!.numericRange).toEqual({ min: 99.5, max: 99.5 });
  });

  it("flags mixed-type paths", () => {
    const mixed = analyse(`<r><v>5</v><v>hi</v></r>`);
    expect(mixed.pathStats.get("/r/v")!.isMixedType).toBe(true);
  });

  it("reports present/empty percentages", () => {
    // vip present on 1 of 2 customers -> phone present on every customer
    const name = r.pathStats.get("/order/customer/name")!;
    expect(name.presentPct).toBe(100);
    const empty = analyse(`<r><a></a><a>x</a></r>`).pathStats.get("/r/a")!;
    expect(empty.emptyPct).toBe(50);
  });

  it("rejects unbound namespace prefixes with a precise error", () => {
    // Per XML namespaces, an undeclared prefix is a well-formedness error.
    expect(() => analyse(`<r><ghost:x>1</ghost:x></r>`)).toThrow(/ghost/);
  });

  it("throws XmlParseError with line/column on malformed input", () => {
    try {
      analyse(`<a><b></a>`);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(XmlParseError);
      expect((e as XmlParseError).line).toBeGreaterThan(0);
    }
  });
});

describe("diff", () => {
  const v14 = `<api><user id="1"><name>A</name><age>30</age></user></api>`;
  const v15 = `<api><user id="1" role="admin"><name>A</name><age>thirty</age><email>a@b.c</email></user></api>`;

  it("schema diff classifies added/removed/type-changed", () => {
    const d = schemaDiff(analyse(v14), analyse(v15));
    expect(d.elementsOnlyInB).toContain("/api/user/email");
    expect(d.attrsOnlyInB).toContain("/api/user@role");
    expect(d.typeChanges.find((t) => t.path === "/api/user/age")).toMatchObject({
      fromType: "integer",
      toType: "string",
    });
    expect(d.common).toContain("/api/user/name");
  });

  it("line diff counts added/removed lines", () => {
    const d = lineDiff(v14, v15);
    expect(d.added).toBeGreaterThan(0);
    expect(prettyXml(v14)).toContain("<user");
  });

  it("formatXml indents and preserves comments + CDATA", () => {
    const f = formatXml(`<r><!-- hi --><a>x</a><b><![CDATA[<raw>]]></b></r>`);
    expect(f).toContain("\n  <a>x</a>"); // child indented one level
    expect(f).toContain("<!-- hi -->"); // comment kept (old prettyXml dropped it)
    expect(f).toContain("<![CDATA[<raw>]]>"); // CDATA kept verbatim
  });

  it("formatXml leaves malformed input untouched", () => {
    expect(formatXml(`<a><b></a>`)).toBe(`<a><b></a>`);
  });

  it("contentType picks dominant non-empty type", () => {
    const s = analyse(`<r><n>1</n><n>2</n><n>x</n></r>`).pathStats.get("/r/n")!;
    expect(contentType(s)).toBe("integer");
  });
});

describe("docgen", () => {
  const r = analyse(SAMPLE, "sample.xml");
  it("markdown includes overview and element reference", () => {
    const md = markdownDoc(r);
    expect(md).toContain("## Overview");
    expect(md).toContain("/order/customer");
    expect(md).toContain("| Attribute | Type | Required |");
  });
  it("html is self-contained", () => {
    const html = htmlDoc(r);
    expect(html).toContain("<style>");
    expect(html).not.toContain("<link");
  });
  it("json dump round-trips paths", () => {
    const dump = JSON.parse(jsonDump(r));
    expect(dump.pathStats["/order/customer"].requiredAttrs).toContain("id");
  });
  it("text report lists attributes", () => {
    expect(textReport(r)).toContain("ATTRIBUTE INVENTORY");
  });
});
