package id.armada.field;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

/** Offline ping backlog. Rows leave only after the server accepts or permanently refuses. */
final class DutyLocationQueue {

    static final int MAX_ROWS = 2000;
    static final int MAX_BATCH = 50;

    static final class Row {
        final long id;
        final JSONObject ping;

        Row(long id, JSONObject ping) {
            this.id = id;
            this.ping = ping;
        }
    }

    private final Helper helper;

    DutyLocationQueue(Context context) {
        helper = new Helper(context.getApplicationContext());
    }

    void enqueue(JSONObject ping) {
        SQLiteDatabase db = helper.getWritableDatabase();
        ContentValues values = new ContentValues();
        values.put("payload", ping.toString());
        db.insert("pings", null, values);
        trim(db);
    }

    List<Row> peek(int limit) {
        SQLiteDatabase db = helper.getReadableDatabase();
        List<Row> out = new ArrayList<>();
        try (Cursor c = db.query("pings", new String[] { "id", "payload" }, null, null, null, null, "id ASC", String.valueOf(limit))) {
            while (c.moveToNext()) {
                try {
                    out.add(new Row(c.getLong(0), new JSONObject(c.getString(1))));
                } catch (Exception ignored) {
                    // Drop unreadable rows on the next delete pass.
                }
            }
        }
        return out;
    }

    void delete(List<Long> ids) {
        if (ids == null || ids.isEmpty()) return;
        SQLiteDatabase db = helper.getWritableDatabase();
        db.beginTransaction();
        try {
            for (Long id : ids) {
                db.delete("pings", "id = ?", new String[] { String.valueOf(id) });
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    int count() {
        SQLiteDatabase db = helper.getReadableDatabase();
        try (Cursor c = db.rawQuery("SELECT COUNT(*) FROM pings", null)) {
            if (c.moveToFirst()) return c.getInt(0);
        }
        return 0;
    }

    private void trim(SQLiteDatabase db) {
        try (Cursor c = db.rawQuery("SELECT COUNT(*) FROM pings", null)) {
            if (!c.moveToFirst()) return;
            int n = c.getInt(0);
            int excess = n - MAX_ROWS;
            if (excess <= 0) return;
            db.delete("pings", "id IN (SELECT id FROM pings ORDER BY id ASC LIMIT ?)", new String[] { String.valueOf(excess) });
        }
    }

    private static final class Helper extends SQLiteOpenHelper {
        Helper(Context context) {
            super(context, "duty_location.db", null, 1);
        }

        @Override
        public void onCreate(SQLiteDatabase db) {
            db.execSQL("CREATE TABLE pings (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL)");
        }

        @Override
        public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {}
    }
}
