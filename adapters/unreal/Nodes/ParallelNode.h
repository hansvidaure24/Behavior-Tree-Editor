#pragma once
#include "BTNode.h"

UCLASS()
class UParallelNode : public UBTNode
{
	GENERATED_BODY()
protected:
	virtual EBTNodeStatus OnTick(UBlackboard* Bb) override
	{
		FString Policy = Parameters.Contains(TEXT("policy")) ? Parameters[TEXT("policy")] : TEXT("fail_on_one");
		int32 SuccessCount = 0, FailCount = 0;
		for (auto* Child : Children)
		{
			EBTNodeStatus Status = Child->Tick(Bb);
			if (Status == EBTNodeStatus::Success) SuccessCount++;
			else if (Status == EBTNodeStatus::Failure) FailCount++;
		}
		if (Policy == TEXT("fail_on_one") && FailCount > 0) return EBTNodeStatus::Failure;
		if (SuccessCount == Children.Num()) return EBTNodeStatus::Success;
		return EBTNodeStatus::Running;
	}
};
