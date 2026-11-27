"""聚合分类结果并输出类别、模块和人工复核清单。"""
from __future__ import annotations
import json, os
import pandas as pd

REQUIRED = ["error_category","error_category_zh","module_id","module_name","layer_id","layer_name"]

def load_classified(path="./output/classified_badcases.json"):
    with open(path,encoding="utf-8") as f: data=json.load(f)
    df=pd.DataFrame(data)
    for c in REQUIRED:
        if c not in df: df[c]=""
    if "needs_review" not in df: df["needs_review"]=False
    if "confidence" not in df: df["confidence"]=0.0
    return df

def aggregate(df):
    total=max(len(df),1)
    df_cat=(df.groupby(["error_category","error_category_zh"],dropna=False).size().reset_index(name="count").sort_values("count",ascending=False).reset_index(drop=True))
    df_cat["pct"]=(df_cat["count"]/total*100).round(1)
    df_cat["label"]=df_cat.apply(lambda r:f"{r['error_category_zh']}\n({r['error_category']})",axis=1)
    df_mod=(df.groupby(["module_id","module_name","layer_id","layer_name"],dropna=False).size().reset_index(name="count").sort_values("count",ascending=False).reset_index(drop=True))
    df_mod["pct"]=(df_mod["count"]/total*100).round(1)
    return df_cat,df_mod

def print_summary(df_cat,df_mod):
    print("\n错误类别 Top 20\n",df_cat[["error_category_zh","error_category","count","pct"]].head(20).to_string(index=False))
    print("\n模块归因 Top 20\n",df_mod[["layer_id","module_id","module_name","count","pct"]].head(20).to_string(index=False))
    layer=df_mod.groupby(["layer_id","layer_name"])["count"].sum().reset_index().sort_values("count",ascending=False)
    print("\n按层汇总\n",layer.to_string(index=False))

def save_csv(df_cat,df_mod,output_dir="./output",source_df=None):
    os.makedirs(output_dir,exist_ok=True)
    df_cat.to_csv(f"{output_dir}/stat_error_category.csv",index=False,encoding="utf-8-sig")
    df_mod.to_csv(f"{output_dir}/stat_module_distribution.csv",index=False,encoding="utf-8-sig")
    if source_df is not None:
        review=source_df[(source_df["needs_review"]==True)|(source_df["module_id"]=="UNCLASSIFIED")|(source_df["module_id"]=="L8.3")].copy()
        review.to_csv(f"{output_dir}/manual_review.csv",index=False,encoding="utf-8-sig")
        print(f"人工复核清单: {len(review)} 条")
    print(f"CSV 已保存到 {output_dir}")

if __name__=="__main__":
    df=load_classified(); a,b=aggregate(df); print_summary(a,b); save_csv(a,b,source_df=df)
