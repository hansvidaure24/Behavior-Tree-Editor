#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "BTNode.h"
#include "Blackboard.h"
#include "Nodes/SequenceNode.h"
#include "Nodes/SelectorNode.h"
#include "Nodes/ParallelNode.h"
#include "Nodes/InvertNode.h"
#include "Nodes/RepeatNode.h"
#include "Nodes/CooldownNode.h"
#include "Nodes/TimeoutNode.h"
#include "Nodes/GuardNode.h"
#include "Nodes/ActionBTNode.h"
#include "Nodes/ConditionBTNode.h"

UCLASS(ClassGroup=(AI), meta=(BlueprintSpawnableComponent))
class UBehaviorTreeRunnerComponent : public UActorComponent
{
	GENERATED_BODY()
public:
	UPROPERTY(EditAnywhere, Category="BehaviorTree")
	FString JsonPath;

	UPROPERTY() UBlackboard* Bb;
	UPROPERTY() UBTNode* Root;
	FString TreeTitle;

	TMap<FString, TFunction<EBTNodeStatus(UBlackboard*)>> Actions;
	TMap<FString, TFunction<bool(UBlackboard*)>> Conditions;

	void RegisterAction(const FString& Name, TFunction<EBTNodeStatus(UBlackboard*)> Fn) { Actions.Add(Name, Fn); }
	void RegisterCondition(const FString& Name, TFunction<bool(UBlackboard*)> Fn) { Conditions.Add(Name, Fn); }

	virtual void BeginPlay() override
	{
		Super::BeginPlay();
		Bb = NewObject<UBlackboard>(this);
		FString JsonText;
		if (FFileHelper::LoadFileToString(JsonText, *JsonPath))
			Root = LoadFromJson(JsonText);
		else
			UE_LOG(LogTemp, Error, TEXT("BehaviorTreeRunner: failed to load %s"), *JsonPath);
	}

	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override
	{
		Super::TickComponent(DeltaTime, TickType, ThisTickFunction);
		if (Root) Root->Tick(Bb);
	}

private:
	UBTNode* LoadFromJson(const FString& Json)
	{
		TSharedPtr<FJsonObject> Parsed;
		TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Json);
		if (!FJsonSerializer::Deserialize(Reader, Parsed) || !Parsed.IsValid()) return nullptr;

		TreeTitle = Parsed->GetStringField(TEXT("title"));
		FString RootId = Parsed->GetStringField(TEXT("root"));
		const TSharedPtr<FJsonObject>* NodesObj;
		if (!Parsed->TryGetObjectField(TEXT("nodes"), NodesObj)) return nullptr;

		TMap<FString, UBTNode*> Built;

		for (auto& Kv : (*NodesObj)->Values)
		{
			auto Nd = Kv.Value->AsObject();
			FString Type = Nd->GetStringField(TEXT("type"));
			FString Name = Nd->HasField(TEXT("name")) ? Nd->GetStringField(TEXT("name")) : Type;
			TMap<FString, FString> Params;
			if (Nd->HasField(TEXT("parameters")))
			{
				auto ParamsObj = Nd->GetObjectField(TEXT("parameters"));
				for (auto& P : ParamsObj->Values)
					Params.Add(P.Key, P.Value->AsString());
			}

			UBTNode* Node = nullptr;
			if (Type == TEXT("sequence")) Node = NewObject<USequenceNode>(this);
			else if (Type == TEXT("selector")) Node = NewObject<USelectorNode>(this);
			else if (Type == TEXT("parallel")) Node = NewObject<UParallelNode>(this);
			else if (Type == TEXT("invert")) Node = NewObject<UInvertNode>(this);
			else if (Type == TEXT("repeat")) Node = NewObject<URepeatNode>(this);
			else if (Type == TEXT("cooldown")) Node = NewObject<UCooldownNode>(this);
			else if (Type == TEXT("timeout")) Node = NewObject<UTimeoutNode>(this);
			else if (Type == TEXT("guard"))
			{
				auto* G = NewObject<UGuardNode>(this);
				if (auto* Fn = Conditions.Find(Name)) G->Condition = *Fn;
				Node = G;
			}
			else if (Type == TEXT("action"))
			{
				auto* A = NewObject<UActionBTNode>(this);
				if (auto* Fn = Actions.Find(Name)) A->Execute = *Fn;
				Node = A;
			}
			else if (Type == TEXT("condition"))
			{
				auto* C = NewObject<UConditionBTNode>(this);
				if (auto* Fn = Conditions.Find(Name)) C->Check = *Fn;
				Node = C;
			}
			else Node = NewObject<UActionBTNode>(this);

			Node->NodeId = Kv.Key;
			Node->NodeName = Name;
			Node->Parameters = Params;
			Built.Add(Kv.Key, Node);
		}

		for (auto& Kv : (*NodesObj)->Values)
		{
			auto Nd = Kv.Value->AsObject();
			const TArray<TSharedPtr<FJsonValue>>* ChildArray;
			if (Nd->TryGetArrayField(TEXT("children"), ChildArray))
			{
				for (auto& Cid : *ChildArray)
				{
					if (auto* ChildNode = Built.Find(Cid->AsString()))
						Built[Kv.Key]->Children.Add(*ChildNode);
				}
			}
		}

		auto* RootNode = Built.Find(RootId);
		return RootNode ? *RootNode : nullptr;
	}
};
