import { randomUUID } from "node:crypto";
import { readMigrationFiles } from "drizzle-orm/migrator";
import pg from "pg";
import { expect, it } from "vitest";
import { testDatabaseConfig } from "../test-database.js";

it("migrates an unambiguous open amount, rejects ambiguous data and enforces current-request constraints", async () => {
  const base = testDatabaseConfig(process.env.TEST_DATABASE_URL);
  const admin = new pg.Client(base);
  const name = `garage_fresh_${randomUUID().replaceAll("-", "")}`;
  let created = false;
  await admin.connect();
  try {
    expect(
      (
        await admin.query(
          "select current_database() as name, current_user as username",
        )
      ).rows[0],
    ).toEqual({ name: "garage_test", username: "garage_test" });
    await admin.query(`create database "${name}"`);
    created = true;
    const client = new pg.Client({ ...base, database: name });
    await client.connect();
    try {
      expect(
        (
          await client.query(
            "select current_database() as name, current_user as username",
          )
        ).rows[0],
      ).toEqual({ name, username: "garage_test" });
      const migrations = readMigrationFiles({
        migrationsFolder: "./migrations",
      });
      expect(migrations).toHaveLength(6);
      for (const migration of migrations.slice(0, 4)) {
        for (const statement of migration.sql) {
          await client.query(statement);
        }
      }
      const id = randomUUID();
      const req = randomUUID();
      await client.query(
        "insert into buildings(code,registration_limit) values ('test',0)",
      );
      await client.query(
        "insert into spaces(building_code,number,floor,category) values ('test',1,1,'CAR')",
      );
      await client.query(
        "insert into sessions(id,building_code,space_number,plate,vehicle_type,category,current_amount) values ($1,'test',1,'test','CAR','CAR',500)",
        [id],
      );
      await client.query(
        "insert into checkout_requests(gate_id,request_id,session_id,is_resident,quoted_amount,paid_at_quote) values ('exit-1',$1,$2,false,500,0),('exit-2',$3,$2,false,500,0)",
        [req, id, randomUUID()],
      );
      const apply = async (index: number) => {
        await client.query("begin");
        try {
          for (const statement of migrations[index].sql) {
            await client.query(statement);
          }
          await client.query("commit");
        } catch (error) {
          await client.query("rollback");
          throw error;
        }
      };
      await expect(apply(4)).rejects.toThrow(
        "Cannot identify current checkout request",
      );
      expect(
        (
          await client.query(
            "select current_amount from sessions where id=$1",
            [id],
          )
        ).rows[0],
      ).toEqual({ current_amount: 500 });
      // A different stale amount does not make 0004's amount match ambiguous,
      // but leaving it unsuperseded would allow a retry to display that amount.
      await client.query(
        "update checkout_requests set quoted_amount=1000 where gate_id='exit-2' and session_id=$1",
        [id],
      );
      await apply(4);
      expect(
        (
          await client.query(
            "select gate_id,quoted_amount from checkout_requests where session_id=$1 and is_current",
            [id],
          )
        ).rows,
      ).toEqual([{ gate_id: "exit-1", quoted_amount: 500 }]);
      expect(
        (
          await client.query(
            "select quoted_amount,superseded,is_current from checkout_requests where gate_id='exit-2' and session_id=$1",
            [id],
          )
        ).rows[0],
      ).toEqual({ quoted_amount: 1000, superseded: false, is_current: false });
      await expect(apply(5)).rejects.toThrow(
        "Unsafe noncurrent checkout request",
      );
      // A refusal leaves both requests untouched for an operator to investigate.
      expect(
        (
          await client.query(
            "select quoted_amount,superseded,is_current from checkout_requests where gate_id='exit-2' and session_id=$1",
            [id],
          )
        ).rows[0],
      ).toEqual({ quoted_amount: 1000, superseded: false, is_current: false });
      await client.query(
        "update checkout_requests set superseded=true where gate_id='exit-2' and session_id=$1",
        [id],
      );
      await apply(5);
      await expect(
        client.query(
          "update checkout_requests set superseded=false,is_current=true where session_id=$1 and gate_id='exit-2'",
          [id],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await expect(
        client.query(
          "update checkout_requests set superseded=true where session_id=$1 and is_current",
          [id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      // A noncurrent uncovered quote is unsafe even if no replacement is current.
      await client.query(
        "update checkout_requests set is_current=false where session_id=$1 and is_current",
        [id],
      );
      await expect(apply(5)).rejects.toThrow(
        "Unsafe noncurrent checkout request",
      );
      // An ordinarily covered request with no current amount is safe to retain
      // for a same-request top-up after grace.
      await client.query(
        "insert into checkout_payments(payment_id,session_id,amount,confirmed_at) values ($1,$2,500,now())",
        [randomUUID(), id],
      );
      await apply(5);
      // Both requests have a paid baseline below the total, so each appears
      // covered, but their replacement order is still unknowable.
      await client.query(
        "update checkout_requests set superseded=false where gate_id='exit-2' and session_id=$1",
        [id],
      );
      const covered = await client.query(
        "select gate_id,quoted_amount,paid_at_quote,superseded,is_current from checkout_requests where session_id=$1 order by gate_id",
        [id],
      );
      expect(covered.rows).toEqual([
        {
          gate_id: "exit-1",
          quoted_amount: 500,
          paid_at_quote: 0,
          superseded: false,
          is_current: false,
        },
        {
          gate_id: "exit-2",
          quoted_amount: 1000,
          paid_at_quote: 0,
          superseded: false,
          is_current: false,
        },
      ]);
      await expect(apply(5)).rejects.toThrow(
        "Unsafe noncurrent checkout request",
      );
      expect(
        (
          await client.query(
            "select gate_id,quoted_amount,paid_at_quote,superseded,is_current from checkout_requests where session_id=$1 order by gate_id",
            [id],
          )
        ).rows,
      ).toEqual(covered.rows);
      await client.query(
        "update checkout_requests set superseded=true where gate_id='exit-2' and session_id=$1",
        [id],
      );
      await apply(5);
      expect(
        (
          await client.query(
            "select column_name from information_schema.columns where table_name='sessions' and column_name='current_amount'",
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      await client.end();
    }
  } finally {
    if (created) {
      await admin.query(`drop database "${name}"`);
    }
    await admin.end();
  }
}, 15000);
